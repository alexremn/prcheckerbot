const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mockOctokitOptions = [];

jest.mock("@octokit/rest", () => ({
  Octokit: {
    plugin: () =>
      function FakeOctokit(options) {
        mockOctokitOptions.push(options);
      },
  },
}));

jest.mock("@octokit/plugin-retry", () => ({ retry: () => ({}) }));

jest.mock("../src/config", () => ({ loadConfig: jest.fn() }));
jest.mock("../src/engine/evaluatePullRequest", () => ({ evaluatePullRequest: jest.fn() }));
jest.mock("../src/github/loadPullRequest", () => ({ loadPullRequest: jest.fn() }));
jest.mock("../src/github/publishCheckRun", () => ({
  publishCheckRun: jest.fn(),
  publishErrorCheckRun: jest.fn(),
}));

const { loadConfig } = require("../src/config");
const { evaluatePullRequest } = require("../src/engine/evaluatePullRequest");
const { loadPullRequest } = require("../src/github/loadPullRequest");
const { publishCheckRun, publishErrorCheckRun } = require("../src/github/publishCheckRun");

const {
  SUPPORTED_EVENTS,
  applyConfigPathOverride,
  parseBool,
  runAction,
  withCheckRunNameOverride,
  writeOutputs,
  writeStepSummary,
} = require("../src/action/runAction");

const ORIGINAL_ENV = process.env;
const ACTION_ENV_PREFIX = /^(GITHUB_|INPUT_|PR_CHECKER_)/;

let tmpDir;
let exitSpy;

function makeResults(failures = [], warnings = []) {
  return { failures, warnings };
}

function makePayloadPr(overrides = {}) {
  return { number: 7, additions: 12, deletions: 3, head: { sha: "abc123" }, ...overrides };
}

function writeEventFile(payload) {
  const eventPath = path.join(tmpDir, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify(payload));
  return eventPath;
}

function setupActionEnv({ eventName = "pull_request", payload } = {}) {
  process.env.GITHUB_EVENT_NAME = eventName;
  process.env.GITHUB_TOKEN = "token-from-env";
  process.env.GITHUB_REPOSITORY = "acme/widgets";
  process.env.GITHUB_EVENT_PATH = writeEventFile(payload || { pull_request: makePayloadPr() });
  process.env.GITHUB_OUTPUT = path.join(tmpDir, "output.txt");
  process.env.GITHUB_STEP_SUMMARY = path.join(tmpDir, "summary.md");
}

function readFileOrNull(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const key of Object.keys(process.env)) {
    if (ACTION_ENV_PREFIX.test(key)) {
      delete process.env[key];
    }
  }

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runaction-"));
  mockOctokitOptions.length = 0;

  jest.clearAllMocks();
  loadConfig.mockReturnValue({ checkRun: { name: "PR Checker" } });
  evaluatePullRequest.mockResolvedValue(makeResults());
  loadPullRequest.mockResolvedValue(makePayloadPr());
  publishCheckRun.mockResolvedValue(undefined);
  publishErrorCheckRun.mockResolvedValue(undefined);

  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`EXIT:${code}`);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = ORIGINAL_ENV;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SUPPORTED_EVENTS", () => {
  test("contains the three pull-request event names the action handles", () => {
    expect([...SUPPORTED_EVENTS].sort()).toEqual([
      "pull_request",
      "pull_request_review",
      "pull_request_target",
    ]);
  });
});

describe("parseBool", () => {
  test("treats true/1/yes as true regardless of case", () => {
    expect(parseBool("true", false)).toBe(true);
    expect(parseBool("TRUE", false)).toBe(true);
    expect(parseBool("1", false)).toBe(true);
    expect(parseBool("yes", false)).toBe(true);
    expect(parseBool("YeS", false)).toBe(true);
  });

  test("treats false/no/0 and unrecognized junk as false", () => {
    expect(parseBool("false", true)).toBe(false);
    expect(parseBool("FALSE", true)).toBe(false);
    expect(parseBool("no", true)).toBe(false);
    expect(parseBool("0", true)).toBe(false);
    expect(parseBool("maybe", true)).toBe(false);
  });

  test("returns the fallback for undefined, null and empty string", () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
    expect(parseBool(null, true)).toBe(true);
    expect(parseBool("", true)).toBe(true);
    expect(parseBool("", false)).toBe(false);
  });

  test("coerces non-string values before matching", () => {
    expect(parseBool(true, false)).toBe(true);
    expect(parseBool(1, false)).toBe(true);
    expect(parseBool(2, true)).toBe(false);
  });
});

describe("writeOutputs", () => {
  test("writes nothing when GITHUB_OUTPUT is unset", () => {
    writeOutputs(makeResults(["boom"], []));

    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test("writes nothing when GITHUB_OUTPUT is an empty string", () => {
    process.env.GITHUB_OUTPUT = "";

    writeOutputs(makeResults());

    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test("reports passed=true with zero counts when there are no failures", () => {
    const outputPath = path.join(tmpDir, "output.txt");
    process.env.GITHUB_OUTPUT = outputPath;

    writeOutputs(makeResults());

    expect(fs.readFileSync(outputPath, "utf8")).toBe(
      "passed=true\nfailure-count=0\nwarning-count=0\n"
    );
  });

  test("reports passed=false with failure and warning counts", () => {
    const outputPath = path.join(tmpDir, "output.txt");
    process.env.GITHUB_OUTPUT = outputPath;

    writeOutputs(makeResults(["a", "b"], ["w"]));

    expect(fs.readFileSync(outputPath, "utf8")).toBe(
      "passed=false\nfailure-count=2\nwarning-count=1\n"
    );
  });

  test("counts warnings while still reporting passed=true", () => {
    const outputPath = path.join(tmpDir, "output.txt");
    process.env.GITHUB_OUTPUT = outputPath;

    writeOutputs(makeResults([], ["w1", "w2"]));

    expect(fs.readFileSync(outputPath, "utf8")).toBe(
      "passed=true\nfailure-count=0\nwarning-count=2\n"
    );
  });

  test("appends to an existing output file instead of truncating it", () => {
    const outputPath = path.join(tmpDir, "output.txt");
    process.env.GITHUB_OUTPUT = outputPath;
    fs.writeFileSync(outputPath, "pre-existing=1\n");

    writeOutputs(makeResults());
    writeOutputs(makeResults(["a"], []));

    expect(fs.readFileSync(outputPath, "utf8")).toBe(
      "pre-existing=1\n" +
        "passed=true\nfailure-count=0\nwarning-count=0\n" +
        "passed=false\nfailure-count=1\nwarning-count=0\n"
    );
  });
});

describe("writeStepSummary", () => {
  test("writes nothing when GITHUB_STEP_SUMMARY is unset", () => {
    writeStepSummary(makeResults(["boom"], []));

    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test("writes nothing when GITHUB_STEP_SUMMARY is an empty string", () => {
    process.env.GITHUB_STEP_SUMMARY = "";

    writeStepSummary(makeResults());

    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test("renders an all-passed body when there are no failures or warnings", () => {
    const summaryPath = path.join(tmpDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    writeStepSummary(makeResults());

    expect(fs.readFileSync(summaryPath, "utf8")).toBe("# PR Checker\n\n✅ All PR checks passed.\n");
  });

  test("renders only a failures section when there are no warnings", () => {
    const summaryPath = path.join(tmpDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    writeStepSummary(makeResults(["❌ a", "❌ b"], []));

    expect(fs.readFileSync(summaryPath, "utf8")).toBe(
      "# PR Checker\n\n## Failures\n\n- ❌ a\n- ❌ b\n\n"
    );
  });

  test("renders only a warnings section when there are no failures", () => {
    const summaryPath = path.join(tmpDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    writeStepSummary(makeResults([], ["⚠️ big PR"]));

    expect(fs.readFileSync(summaryPath, "utf8")).toBe(
      "# PR Checker\n\n## Warnings\n\n- ⚠️ big PR\n\n"
    );
  });

  test("renders failures before warnings when both are present", () => {
    const summaryPath = path.join(tmpDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    writeStepSummary(makeResults(["❌ a"], ["⚠️ w"]));

    expect(fs.readFileSync(summaryPath, "utf8")).toBe(
      "# PR Checker\n\n## Failures\n\n- ❌ a\n\n## Warnings\n\n- ⚠️ w\n\n"
    );
  });

  test("appends to an existing summary file instead of truncating it", () => {
    const summaryPath = path.join(tmpDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    fs.writeFileSync(summaryPath, "earlier step\n");

    writeStepSummary(makeResults());

    expect(fs.readFileSync(summaryPath, "utf8")).toBe(
      "earlier step\n# PR Checker\n\n✅ All PR checks passed.\n"
    );
  });
});

describe("applyConfigPathOverride", () => {
  test("copies INPUT_CONFIG_PATH into PR_CHECKER_CONFIG_PATH", () => {
    process.env.INPUT_CONFIG_PATH = "./custom.json";

    applyConfigPathOverride();

    expect(process.env.PR_CHECKER_CONFIG_PATH).toBe("./custom.json");
  });

  test("leaves PR_CHECKER_CONFIG_PATH untouched when INPUT_CONFIG_PATH is unset", () => {
    process.env.PR_CHECKER_CONFIG_PATH = "./already-set.json";

    applyConfigPathOverride();

    expect(process.env.PR_CHECKER_CONFIG_PATH).toBe("./already-set.json");
  });

  test("leaves PR_CHECKER_CONFIG_PATH untouched when INPUT_CONFIG_PATH is an empty string", () => {
    process.env.INPUT_CONFIG_PATH = "";

    applyConfigPathOverride();

    expect(process.env.PR_CHECKER_CONFIG_PATH).toBeUndefined();
  });
});

describe("withCheckRunNameOverride", () => {
  test("returns the same config object when INPUT_CHECK_RUN_NAME is unset", () => {
    const config = { checkRun: { name: "PR Checker" } };

    expect(withCheckRunNameOverride(config)).toBe(config);
  });

  test("returns the same config object when INPUT_CHECK_RUN_NAME is an empty string", () => {
    process.env.INPUT_CHECK_RUN_NAME = "";
    const config = { checkRun: { name: "PR Checker" } };

    expect(withCheckRunNameOverride(config)).toBe(config);
  });

  test("returns a new config with the name overridden and other keys preserved", () => {
    process.env.INPUT_CHECK_RUN_NAME = "Custom Check";
    const config = { checks: { size: { enabled: true } }, checkRun: { name: "PR Checker", detailsUrl: "https://x" } };

    const result = withCheckRunNameOverride(config);

    expect(result).not.toBe(config);
    expect(result.checkRun).toEqual({ name: "Custom Check", detailsUrl: "https://x" });
    expect(result.checks).toBe(config.checks);
  });

  test("does not mutate the input config", () => {
    process.env.INPUT_CHECK_RUN_NAME = "Custom Check";
    const config = { checkRun: { name: "PR Checker" } };

    withCheckRunNameOverride(config);

    expect(config.checkRun.name).toBe("PR Checker");
  });

  test("creates a checkRun block when the config has none", () => {
    process.env.INPUT_CHECK_RUN_NAME = "Custom Check";

    expect(withCheckRunNameOverride({})).toEqual({ checkRun: { name: "Custom Check" } });
  });
});

describe("runAction event gating", () => {
  test("warns and returns without exiting for an unsupported event", async () => {
    setupActionEnv({ eventName: "push" });

    await runAction();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Event "push" is not supported'));
    expect(exitSpy).not.toHaveBeenCalled();
    expect(evaluatePullRequest).not.toHaveBeenCalled();
  });

  test("warns and returns without exiting when GITHUB_EVENT_NAME is absent", async () => {
    setupActionEnv();
    delete process.env.GITHUB_EVENT_NAME;

    await runAction();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Event "" is not supported'));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("runs for pull_request_target events", async () => {
    setupActionEnv({ eventName: "pull_request_target" });

    await runAction();

    expect(evaluatePullRequest).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("runAction environment validation", () => {
  test("exits 2 when no token is available", async () => {
    setupActionEnv();
    delete process.env.GITHUB_TOKEN;

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Missing github-token"));
    expect(evaluatePullRequest).not.toHaveBeenCalled();
  });

  test("exits 2 when GITHUB_TOKEN is an empty string", async () => {
    setupActionEnv();
    process.env.GITHUB_TOKEN = "";

    await expect(runAction()).rejects.toThrow("EXIT:2");
  });

  test("prefers INPUT_GITHUB_TOKEN over GITHUB_TOKEN", async () => {
    setupActionEnv();
    process.env.INPUT_GITHUB_TOKEN = "token-from-input";

    await runAction();

    expect(mockOctokitOptions).toEqual([
      { auth: "token-from-input", userAgent: "github-prchecker-action" },
    ]);
  });

  test("falls back to GITHUB_TOKEN when INPUT_GITHUB_TOKEN is empty", async () => {
    setupActionEnv();
    process.env.INPUT_GITHUB_TOKEN = "";

    await runAction();

    expect(mockOctokitOptions[0].auth).toBe("token-from-env");
  });

  test("exits 2 when GITHUB_EVENT_PATH is missing", async () => {
    setupActionEnv();
    delete process.env.GITHUB_EVENT_PATH;

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Missing GITHUB_EVENT_PATH")
    );
  });

  // These used to escape runAction as a raw SyntaxError/ENOENT stack caught only
  // by src/action.js (exit 1), instead of the clean exit 2 every other
  // environment problem produces.
  test("exits 2 when the event file contains malformed JSON", async () => {
    setupActionEnv();
    fs.writeFileSync(process.env.GITHUB_EVENT_PATH, "not json{{{");

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read GITHUB_EVENT_PATH")
    );
  });

  test("exits 2 when the event file does not exist", async () => {
    setupActionEnv();
    process.env.GITHUB_EVENT_PATH = path.join(tmpDir, "no-such-event.json");

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read GITHUB_EVENT_PATH")
    );
  });

  test.each([
    ["null", "null"],
    ["an array", "[1,2]"],
    ["a number", "42"],
    ["a string", '"nope"'],
  ])("exits 2 when the event payload is %s rather than an object", async (_label, body) => {
    setupActionEnv();
    fs.writeFileSync(process.env.GITHUB_EVENT_PATH, body);

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("event payload must be a JSON object")
    );
  });

  test("exits 2 when GITHUB_REPOSITORY is absent", async () => {
    setupActionEnv();
    delete process.env.GITHUB_REPOSITORY;

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid GITHUB_REPOSITORY: ""')
    );
  });

  test("exits 2 when GITHUB_REPOSITORY has no slash", async () => {
    setupActionEnv();
    process.env.GITHUB_REPOSITORY = "noslash";

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid GITHUB_REPOSITORY: "noslash"')
    );
  });

  test("exits 2 when GITHUB_REPOSITORY has an empty repo segment", async () => {
    setupActionEnv();
    process.env.GITHUB_REPOSITORY = "acme/";

    await expect(runAction()).rejects.toThrow("EXIT:2");
  });

  test("exits 2 when GITHUB_REPOSITORY has an empty owner segment", async () => {
    setupActionEnv();
    process.env.GITHUB_REPOSITORY = "/widgets";

    await expect(runAction()).rejects.toThrow("EXIT:2");
  });

  test("exits 2 when the event payload has no pull_request", async () => {
    setupActionEnv({ payload: { action: "opened" } });

    await expect(runAction()).rejects.toThrow("EXIT:2");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("No pull_request found in event payload")
    );
    expect(evaluatePullRequest).not.toHaveBeenCalled();
  });
});

describe("runAction pull request loading", () => {
  test("uses the payload pull request when additions are already present", async () => {
    const payloadPr = makePayloadPr();
    setupActionEnv({ payload: { pull_request: payloadPr } });

    await runAction();

    expect(loadPullRequest).not.toHaveBeenCalled();
    expect(evaluatePullRequest.mock.calls[0][1]).toEqual(payloadPr);
  });

  test("uses the payload pull request when additions are zero", async () => {
    setupActionEnv({ payload: { pull_request: makePayloadPr({ additions: 0 }) } });

    await runAction();

    expect(loadPullRequest).not.toHaveBeenCalled();
  });

  test("refetches the pull request for review events", async () => {
    const loadedPr = makePayloadPr({ number: 42, additions: 99 });
    loadPullRequest.mockResolvedValue(loadedPr);
    setupActionEnv({
      eventName: "pull_request_review",
      payload: { pull_request: makePayloadPr({ number: 42 }) },
    });

    await runAction();

    expect(loadPullRequest).toHaveBeenCalledTimes(1);
    expect(loadPullRequest.mock.calls[0][1]).toBe(42);
    expect(loadPullRequest.mock.calls[0][0].repo()).toEqual({ owner: "acme", repo: "widgets" });
    expect(evaluatePullRequest.mock.calls[0][1]).toBe(loadedPr);
  });

  test("refetches the pull request when additions are undefined", async () => {
    setupActionEnv({ payload: { pull_request: { number: 7, head: { sha: "abc123" } } } });

    await runAction();

    expect(loadPullRequest).toHaveBeenCalledTimes(1);
    expect(loadPullRequest.mock.calls[0][1]).toBe(7);
  });

  test("refetches the pull request when additions are not a finite number", async () => {
    setupActionEnv({ payload: { pull_request: makePayloadPr({ additions: null }) } });

    await runAction();

    expect(loadPullRequest).toHaveBeenCalledTimes(1);
  });
});

describe("runAction configuration wiring", () => {
  test("applies INPUT_CONFIG_PATH before loading the config", async () => {
    let configPathAtLoad;
    loadConfig.mockImplementation(() => {
      configPathAtLoad = process.env.PR_CHECKER_CONFIG_PATH;
      return { checkRun: { name: "PR Checker" } };
    });
    setupActionEnv();
    process.env.INPUT_CONFIG_PATH = "./ci/pr-checker.json";

    await runAction();

    expect(configPathAtLoad).toBe("./ci/pr-checker.json");
  });

  test("passes the check run name override through to evaluation", async () => {
    setupActionEnv();
    process.env.INPUT_CHECK_RUN_NAME = "Custom Check";

    await runAction();

    expect(evaluatePullRequest.mock.calls[0][2].checkRun.name).toBe("Custom Check");
  });

  test("builds a context exposing the octokit client, repo and payload", async () => {
    const payload = { action: "opened", pull_request: makePayloadPr() };
    setupActionEnv({ payload });

    await runAction();

    const context = evaluatePullRequest.mock.calls[0][0];
    expect(context.repo()).toEqual({ owner: "acme", repo: "widgets" });
    expect(context.payload).toEqual(payload);
    expect(typeof context.octokit).toBe("object");
  });
});

describe("runAction success path", () => {
  test("publishes a check run and writes outputs and summary when all checks pass", async () => {
    setupActionEnv();

    await runAction();

    expect(publishCheckRun).toHaveBeenCalledTimes(1);
    expect(publishErrorCheckRun).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(process.env.GITHUB_OUTPUT, "utf8")).toBe(
      "passed=true\nfailure-count=0\nwarning-count=0\n"
    );
    expect(fs.readFileSync(process.env.GITHUB_STEP_SUMMARY, "utf8")).toBe(
      "# PR Checker\n\n✅ All PR checks passed.\n"
    );
  });

  test("does not exit when only warnings are present", async () => {
    evaluatePullRequest.mockResolvedValue(makeResults([], ["⚠️ big PR"]));
    setupActionEnv();

    await runAction();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(process.env.GITHUB_OUTPUT, "utf8")).toBe(
      "passed=true\nfailure-count=0\nwarning-count=1\n"
    );
  });

  test("skips outputs and summary when the runner paths are not set", async () => {
    setupActionEnv();
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;

    await runAction();

    expect(fs.readdirSync(tmpDir)).toEqual(["event.json"]);
  });
});

describe("runAction failure exit codes", () => {
  test("exits 1 when failures are present and fail-on-failure defaults to true", async () => {
    evaluatePullRequest.mockResolvedValue(makeResults(["❌ nope"], []));
    setupActionEnv();

    await expect(runAction()).rejects.toThrow("EXIT:1");
    expect(fs.readFileSync(process.env.GITHUB_OUTPUT, "utf8")).toBe(
      "passed=false\nfailure-count=1\nwarning-count=0\n"
    );
  });

  test("does not exit when failures are present and INPUT_FAIL_ON_FAILURE is false", async () => {
    evaluatePullRequest.mockResolvedValue(makeResults(["❌ nope"], []));
    setupActionEnv();
    process.env.INPUT_FAIL_ON_FAILURE = "false";

    await runAction();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(process.env.GITHUB_OUTPUT, "utf8")).toBe(
      "passed=false\nfailure-count=1\nwarning-count=0\n"
    );
    expect(fs.readFileSync(process.env.GITHUB_STEP_SUMMARY, "utf8")).toContain("## Failures");
  });

  test("still exits 1 when INPUT_FAIL_ON_FAILURE is an unrecognized truthy-looking value", async () => {
    evaluatePullRequest.mockResolvedValue(makeResults(["❌ nope"], []));
    setupActionEnv();
    process.env.INPUT_FAIL_ON_FAILURE = "yes";

    await expect(runAction()).rejects.toThrow("EXIT:1");
  });
});

describe("runAction evaluation errors", () => {
  test("publishes an error check run and exits 1 when evaluation throws", async () => {
    const error = new Error("boom");
    evaluatePullRequest.mockRejectedValue(error);
    setupActionEnv();

    await expect(runAction()).rejects.toThrow("EXIT:1");
    expect(publishErrorCheckRun).toHaveBeenCalledTimes(1);
    expect(publishErrorCheckRun.mock.calls[0][2]).toBe(error);
    expect(publishCheckRun).not.toHaveBeenCalled();
  });

  test("exits 0 when evaluation throws and INPUT_FAIL_ON_FAILURE is false", async () => {
    evaluatePullRequest.mockRejectedValue(new Error("boom"));
    setupActionEnv();
    process.env.INPUT_FAIL_ON_FAILURE = "false";

    await expect(runAction()).rejects.toThrow("EXIT:0");
  });

  test("still writes outputs and step summary when evaluation throws", async () => {
    evaluatePullRequest.mockRejectedValue(new Error("boom"));
    setupActionEnv();

    await expect(runAction()).rejects.toThrow("EXIT:1");

    const outputs = readFileOrNull(process.env.GITHUB_OUTPUT);
    expect(outputs).toContain("passed=false");
    expect(outputs).toContain("failure-count=1");
    expect(outputs).toContain("warning-count=0");

    const summary = readFileOrNull(process.env.GITHUB_STEP_SUMMARY);
    expect(summary).toContain("## Failures");
    expect(summary).toContain("PR checker failed to run: boom");
  });

  // Regression guard: exiting before writeOutputs left `passed` empty, so with
  // fail-on-failure=false a downstream `outputs.passed == 'false'` gate never
  // fired and a crashed evaluation was indistinguishable from a clean pass.
  test("reports passed=false even when INPUT_FAIL_ON_FAILURE is false", async () => {
    evaluatePullRequest.mockRejectedValue(new Error("boom"));
    setupActionEnv();
    process.env.INPUT_FAIL_ON_FAILURE = "false";

    await expect(runAction()).rejects.toThrow("EXIT:0");
    expect(readFileOrNull(process.env.GITHUB_OUTPUT)).toContain("passed=false");
  });

  test("swallows a failing error check run and keeps the same exit code", async () => {
    evaluatePullRequest.mockRejectedValue(new Error("boom"));
    publishErrorCheckRun.mockRejectedValue(new Error("403 read-only token"));
    setupActionEnv();

    await expect(runAction()).rejects.toThrow("EXIT:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to publish error check run")
    );
  });
});

describe("runAction check run publish failures", () => {
  test("still writes outputs and summary when publishing the check run fails", async () => {
    publishCheckRun.mockRejectedValue(new Error("403 read-only token on fork"));
    evaluatePullRequest.mockResolvedValue(makeResults([], ["⚠️ big PR"]));
    setupActionEnv();

    await runAction();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to publish check run")
    );
    expect(fs.readFileSync(process.env.GITHUB_OUTPUT, "utf8")).toBe(
      "passed=true\nfailure-count=0\nwarning-count=1\n"
    );
    expect(fs.readFileSync(process.env.GITHUB_STEP_SUMMARY, "utf8")).toContain("## Warnings");
  });

  test("still applies the failure exit code when publishing the check run fails", async () => {
    publishCheckRun.mockRejectedValue(new Error("403 read-only token on fork"));
    evaluatePullRequest.mockResolvedValue(makeResults(["❌ nope"], []));
    setupActionEnv();

    await expect(runAction()).rejects.toThrow("EXIT:1");
    expect(fs.readFileSync(process.env.GITHUB_OUTPUT, "utf8")).toBe(
      "passed=false\nfailure-count=1\nwarning-count=0\n"
    );
  });
});

describe("runAction non-Error evaluation rejections", () => {
  test("reports passed=false and the stringified value when evaluation rejects with a string", async () => {
    evaluatePullRequest.mockRejectedValue("kaboom");
    setupActionEnv();

    await expect(runAction()).rejects.toThrow("EXIT:1");

    expect(readFileOrNull(process.env.GITHUB_OUTPUT)).toContain("passed=false");
    expect(readFileOrNull(process.env.GITHUB_STEP_SUMMARY)).toContain(
      "PR checker failed to run: kaboom"
    );
  });

  test("reports passed=false and the stringified value when evaluation rejects with null", async () => {
    evaluatePullRequest.mockRejectedValue(null);
    setupActionEnv();

    await expect(runAction()).rejects.toThrow("EXIT:1");

    expect(readFileOrNull(process.env.GITHUB_OUTPUT)).toContain("passed=false");
    expect(readFileOrNull(process.env.GITHUB_STEP_SUMMARY)).toContain(
      "PR checker failed to run: null"
    );
  });
});
