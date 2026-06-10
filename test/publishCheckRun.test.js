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
