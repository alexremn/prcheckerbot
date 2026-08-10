const {
  buildSummary,
  getCheckRunName,
  publishCheckRun,
  publishErrorCheckRun,
} = require("../src/github/publishCheckRun");

describe("getCheckRunName", () => {
  test("returns configured name", () => {
    expect(getCheckRunName({ checkRun: { name: "Custom" } })).toBe("Custom");
  });

  test("falls back to default", () => {
    expect(getCheckRunName({})).toBe("PR Checker");
    expect(getCheckRunName(undefined)).toBe("PR Checker");
  });
});

describe("buildSummary", () => {
  test("all passed", () => {
    const result = buildSummary({ failures: [], warnings: [] });
    expect(result.passed).toBe(true);
    expect(result.statusText).toBe("All checks passed");
  });

  test("passed with warnings", () => {
    const result = buildSummary({ failures: [], warnings: ["⚠️ big PR"] });
    expect(result.passed).toBe(true);
    expect(result.statusText).toBe("Passed with 1 warning");
    expect(result.summary).toContain("## Warnings");
  });

  test("failures present", () => {
    const result = buildSummary({ failures: ["❌ no labels", "❌ no description"], warnings: [] });
    expect(result.passed).toBe(false);
    expect(result.statusText).toBe("2 issues found");
    expect(result.summary).toContain("## Failures");
  });
});

function makeContext() {
  return {
    octokit: { rest: { checks: { create: jest.fn().mockResolvedValue({}) } } },
    log: { info: jest.fn(), error: jest.fn() },
    repo: () => ({ owner: "acme", repo: "widgets" }),
  };
}

const pr = { number: 7, head: { sha: "abc123" } };

describe("publishCheckRun", () => {
  test("creates success check run when no failures", async () => {
    const context = makeContext();

    await publishCheckRun(context, pr, { failures: [], warnings: [] }, {});

    expect(context.octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        head_sha: "abc123",
        conclusion: "success",
      })
    );
  });

  test("creates failure check run when failures exist", async () => {
    const context = makeContext();

    await publishCheckRun(context, pr, { failures: ["❌ nope"], warnings: [] }, {});

    expect(context.octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: "failure" })
    );
  });
});

describe("publishErrorCheckRun", () => {
  test("creates failure check run with error message inline", async () => {
    const context = makeContext();

    await publishErrorCheckRun(context, pr, new Error("boom"), {});

    const call = context.octokit.rest.checks.create.mock.calls[0][0];
    expect(call.conclusion).toBe("failure");
    expect(call.output.summary).toContain("boom");
  });
});

describe("buildSummary count wording", () => {
  test("pluralizes the warning count when more than one warning is present", () => {
    const result = buildSummary({ failures: [], warnings: ["⚠️ big PR", "⚠️ stale branch"] });

    expect(result.passed).toBe(true);
    expect(result.statusText).toBe("Passed with 2 warnings");
  });

  test("uses singular issue wording for exactly one failure", () => {
    const result = buildSummary({ failures: ["❌ no labels"], warnings: [] });

    expect(result.passed).toBe(false);
    expect(result.statusText).toBe("1 issue found");
  });

  test("renders failures before warnings when both are present", () => {
    const result = buildSummary({ failures: ["❌ no labels"], warnings: ["⚠️ big PR"] });

    expect(result.statusText).toBe("1 issue found");
    expect(result.summary.indexOf("## Failures")).toBeLessThan(
      result.summary.indexOf("## Warnings")
    );
  });
});

describe("publishCheckRun reporting", () => {
  test("logs a success line and names the PR in the output text", async () => {
    const context = makeContext();

    await publishCheckRun(context, pr, { failures: [], warnings: [] }, {});

    expect(context.log.info).toHaveBeenCalledWith("Check run created for PR #7: success");
    expect(context.octokit.rest.checks.create.mock.calls[0][0].output.text).toContain(
      "Checked PR #7"
    );
  });

  test("logs a failure line when failures are present", async () => {
    const context = makeContext();

    await publishCheckRun(context, pr, { failures: ["❌ nope"], warnings: [] }, {});

    expect(context.log.info).toHaveBeenCalledWith("Check run created for PR #7: failure");
  });
});

async function errorSummaryFor(thrown) {
  const context = makeContext();

  await publishErrorCheckRun(context, pr, thrown, {});

  return context.octokit.rest.checks.create.mock.calls[0][0].output.summary;
}

describe("publishErrorCheckRun message fallback", () => {
  test("stringifies a thrown string", async () => {
    expect(await errorSummaryFor("kaboom")).toContain("kaboom");
  });

  test("stringifies a thrown number", async () => {
    expect(await errorSummaryFor(42)).toContain("42");
  });

  test("stringifies a thrown null", async () => {
    expect(await errorSummaryFor(null)).toContain("null");
  });

  test("stringifies a thrown object that has no message property", async () => {
    expect(await errorSummaryFor({ code: "E_FAIL" })).toContain("[object Object]");
  });

  test("stringifies an Error whose message is empty", async () => {
    expect(await errorSummaryFor(new Error(""))).toContain("Error");
  });
});
