jest.mock("../src/engine/evaluatePullRequest");
jest.mock("../src/github/publishCheckRun");

const { evaluatePullRequest } = require("../src/engine/evaluatePullRequest");
const { publishCheckRun, publishErrorCheckRun } = require("../src/github/publishCheckRun");
const { runPrValidation } = require("../src/workflow/runPrValidation");

function makeContext(payload = {}) {
  return {
    octokit: { rest: { checks: { create: jest.fn() } } },
    log: { info: jest.fn(), error: jest.fn() },
    payload: { action: "opened", repository: { full_name: "acme/widgets" }, ...payload },
    repo: () => ({ owner: "acme", repo: "widgets" }),
  };
}

function makePr(overrides = {}) {
  return {
    number: 7,
    title: "Add feature",
    html_url: "https://github.com/acme/widgets/pull/7",
    head: { sha: "abc123" },
    ...overrides,
  };
}

const config = { checkRun: { name: "PR Checker" } };

afterEach(() => {
  jest.resetAllMocks();
});

describe("runPrValidation logging", () => {
  test("logs repo, pr number, action and url as structured fields", async () => {
    const context = makeContext();
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await runPrValidation(context, makePr(), config);

    expect(context.log.info).toHaveBeenCalledWith(
      {
        repo: "acme/widgets",
        pr: 7,
        action: "opened",
        url: "https://github.com/acme/widgets/pull/7",
      },
      expect.any(String)
    );
  });

  test("includes action and repo in the log message when both are present", async () => {
    const context = makeContext();
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await runPrValidation(context, makePr(), config);

    expect(context.log.info.mock.calls[0][1]).toBe("PR #7 (opened) [acme/widgets] Add feature");
  });

  test("omits the repo segment when payload.repository is undefined", async () => {
    const context = makeContext({ repository: undefined });
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await runPrValidation(context, makePr(), config);

    expect(context.log.info.mock.calls[0][0].repo).toBeUndefined();
    expect(context.log.info.mock.calls[0][1]).toBe("PR #7 (opened) Add feature");
  });

  test("omits the action segment when payload.action is undefined", async () => {
    const context = makeContext({ action: undefined });
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await runPrValidation(context, makePr(), config);

    expect(context.log.info.mock.calls[0][0].action).toBeUndefined();
    expect(context.log.info.mock.calls[0][1]).toBe("PR #7 [acme/widgets] Add feature");
  });

  test("omits both segments when the payload carries neither action nor repository", async () => {
    const context = makeContext({ action: undefined, repository: undefined });
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await runPrValidation(context, makePr({ title: "" }), config);

    expect(context.log.info.mock.calls[0][1]).toBe("PR #7 ");
  });

  test("omits the repo segment when repository exists without a full_name", async () => {
    const context = makeContext({ repository: {} });
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await runPrValidation(context, makePr(), config);

    expect(context.log.info.mock.calls[0][1]).toBe("PR #7 (opened) Add feature");
  });

  test("omits the action segment when payload.action is an empty string", async () => {
    const context = makeContext({ action: "" });
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await runPrValidation(context, makePr(), config);

    expect(context.log.info.mock.calls[0][1]).toBe("PR #7 [acme/widgets] Add feature");
  });
});

describe("runPrValidation happy path", () => {
  test("publishes the evaluation results as a check run", async () => {
    const context = makeContext();
    const pr = makePr();
    const results = { failures: ["❌ nope"], warnings: ["⚠️ big PR"] };
    evaluatePullRequest.mockResolvedValue(results);

    await runPrValidation(context, pr, config);

    expect(evaluatePullRequest).toHaveBeenCalledWith(context, pr, config);
    expect(publishCheckRun).toHaveBeenCalledWith(context, pr, results, config);
    expect(publishErrorCheckRun).not.toHaveBeenCalled();
    expect(context.log.error).not.toHaveBeenCalled();
  });

  test("resolves to undefined on success", async () => {
    const context = makeContext();
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });

    await expect(runPrValidation(context, makePr(), config)).resolves.toBeUndefined();
  });

  test("propagates a rejection from publishCheckRun", async () => {
    const context = makeContext();
    evaluatePullRequest.mockResolvedValue({ failures: [], warnings: [] });
    publishCheckRun.mockRejectedValue(new Error("checks: write denied"));

    await expect(runPrValidation(context, makePr(), config)).rejects.toThrow("checks: write denied");
  });
});

describe("runPrValidation when evaluation fails", () => {
  test("logs the error, publishes an error check run and skips the normal check run", async () => {
    const context = makeContext();
    const pr = makePr();
    const error = new Error("boom");
    evaluatePullRequest.mockRejectedValue(error);

    await runPrValidation(context, pr, config);

    expect(context.log.error).toHaveBeenCalledWith({ err: error }, "Evaluation failed for PR #7");
    expect(publishErrorCheckRun).toHaveBeenCalledWith(context, pr, error, config);
    expect(publishCheckRun).not.toHaveBeenCalled();
  });

  test("does not rethrow the evaluation error", async () => {
    const context = makeContext();
    evaluatePullRequest.mockRejectedValue(new Error("boom"));

    await expect(runPrValidation(context, makePr(), config)).resolves.toBeUndefined();
  });

  test("handles a non-Error rejection value", async () => {
    const context = makeContext();
    evaluatePullRequest.mockRejectedValue("string failure");

    await expect(runPrValidation(context, makePr(), config)).resolves.toBeUndefined();

    expect(context.log.error).toHaveBeenCalledWith({ err: "string failure" }, "Evaluation failed for PR #7");
    expect(publishErrorCheckRun).toHaveBeenCalledWith(context, expect.anything(), "string failure", config);
  });

  test("swallows a failure from publishErrorCheckRun and still does not rethrow", async () => {
    const context = makeContext();
    const evaluationError = new Error("boom");
    const publishFailure = new Error("checks: write denied on fork PR");
    evaluatePullRequest.mockRejectedValue(evaluationError);
    publishErrorCheckRun.mockRejectedValue(publishFailure);

    await expect(runPrValidation(context, makePr(), config)).resolves.toBeUndefined();

    expect(context.log.error).toHaveBeenNthCalledWith(1, { err: evaluationError }, "Evaluation failed for PR #7");
    expect(context.log.error).toHaveBeenNthCalledWith(
      2,
      { err: publishFailure },
      "Failed to publish error check run for PR #7"
    );
    expect(publishCheckRun).not.toHaveBeenCalled();
  });
});
