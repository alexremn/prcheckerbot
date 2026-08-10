const { buildActionContext, createConsoleLogger } = require("../src/action/buildActionContext");

function makeConsoleSpies() {
  return {
    log: jest.spyOn(console, "log").mockImplementation(() => {}),
    warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
    error: jest.spyOn(console, "error").mockImplementation(() => {}),
  };
}

function makeErrorWithoutStack(message) {
  const error = new Error(message);
  error.stack = undefined;
  return error;
}

function makeCircularObject() {
  const circular = { name: "loop" };
  circular.self = circular;
  return circular;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildActionContext", () => {
  test("passes octokit, log and payload through unchanged", () => {
    const octokit = { rest: {} };
    const log = { info: jest.fn() };
    const payload = { action: "opened", pull_request: { number: 7 } };

    const context = buildActionContext({ octokit, log, owner: "acme", repo: "widgets", payload });

    expect(context.octokit).toBe(octokit);
    expect(context.log).toBe(log);
    expect(context.payload).toBe(payload);
  });

  test("repo() returns owner and repo", () => {
    const context = buildActionContext({
      octokit: {},
      log: {},
      owner: "acme",
      repo: "widgets",
      payload: {},
    });

    expect(context.repo()).toEqual({ owner: "acme", repo: "widgets" });
  });

  test("repo() returns the same values on repeated calls", () => {
    const context = buildActionContext({
      octokit: {},
      log: {},
      owner: "acme",
      repo: "widgets",
      payload: {},
    });

    expect(context.repo()).toEqual(context.repo());
  });

  test("exposes only the Probot-shaped keys", () => {
    const context = buildActionContext({
      octokit: {},
      log: {},
      owner: "acme",
      repo: "widgets",
      payload: {},
    });

    expect(Object.keys(context).sort()).toEqual(["log", "octokit", "payload", "repo"]);
  });

  test("carries undefined through when fields are missing", () => {
    const context = buildActionContext({});

    expect(context.octokit).toBeUndefined();
    expect(context.log).toBeUndefined();
    expect(context.payload).toBeUndefined();
    expect(context.repo()).toEqual({ owner: undefined, repo: undefined });
  });

  test("keeps empty-string owner and repo as given", () => {
    const context = buildActionContext({ octokit: {}, log: {}, owner: "", repo: "", payload: null });

    expect(context.repo()).toEqual({ owner: "", repo: "" });
    expect(context.payload).toBeNull();
  });
});

describe("createConsoleLogger levels", () => {
  test("info writes to console.log with an [info] prefix", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().info("hello");

    expect(spies.log).toHaveBeenCalledWith("[info] hello");
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  test("warn writes to console.warn with a [warn] prefix", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().warn("careful");

    expect(spies.warn).toHaveBeenCalledWith("[warn] careful");
    expect(spies.log).not.toHaveBeenCalled();
  });

  test("error writes to console.error with an [error] prefix", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().error("broken");

    expect(spies.error).toHaveBeenCalledWith("[error] broken");
  });

  test("fatal writes to console.error with a [fatal] prefix", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().fatal("dead");

    expect(spies.error).toHaveBeenCalledWith("[fatal] dead");
  });

  test("debug and trace are silent no-ops returning undefined", () => {
    const spies = makeConsoleSpies();
    const logger = createConsoleLogger();

    expect(logger.debug("nothing", { a: 1 })).toBeUndefined();
    expect(logger.trace("nothing", { a: 1 })).toBeUndefined();

    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  test("debug and trace share one no-op implementation", () => {
    const logger = createConsoleLogger();

    expect(logger.debug).toBe(logger.trace);
  });
});

describe("createConsoleLogger argument formatting", () => {
  test("renders an Error as its stack", () => {
    const spies = makeConsoleSpies();
    const error = new Error("boom");

    createConsoleLogger().error(error);

    expect(spies.error).toHaveBeenCalledWith(`[error] ${error.stack}`);
    expect(spies.error.mock.calls[0][0]).toContain("boom");
  });

  test("falls back to the message for an Error without a stack", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().error(makeErrorWithoutStack("stackless"));

    expect(spies.error).toHaveBeenCalledWith("[error] stackless");
  });

  test("renders the nested err stack for an object carrying an Error", () => {
    const spies = makeConsoleSpies();
    const err = new Error("nested boom");

    createConsoleLogger().error({ err, extra: "ignored" });

    expect(spies.error).toHaveBeenCalledWith(`[error] ${err.stack}`);
  });

  test("falls back to the nested err message when that Error has no stack", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().error({ err: makeErrorWithoutStack("nested stackless") });

    expect(spies.error).toHaveBeenCalledWith("[error] nested stackless");
  });

  test("JSON-stringifies a plain object", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().info({ pr: 7, repo: "widgets" });

    expect(spies.log).toHaveBeenCalledWith('[info] {"pr":7,"repo":"widgets"}');
  });

  test("JSON-stringifies an object whose err is not an Error", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().info({ err: "plain string" });

    expect(spies.log).toHaveBeenCalledWith('[info] {"err":"plain string"}');
  });

  test("JSON-stringifies arrays including the empty array", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().info([1, "two"], []);

    expect(spies.log).toHaveBeenCalledWith('[info] [1,"two"] []');
  });

  test("falls back to String() when the object cannot be stringified", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().warn(makeCircularObject());

    expect(spies.warn).toHaveBeenCalledWith("[warn] [object Object]");
  });

  test("stringifies primitives", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().info(42, true, "", Symbol.for("sym"));

    expect(spies.log).toHaveBeenCalledWith("[info] 42 true  Symbol(sym)");
  });

  test("stringifies null and undefined", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().info(null, undefined);

    expect(spies.log).toHaveBeenCalledWith("[info] null undefined");
  });

  test("joins multiple mixed args with a single space", () => {
    const spies = makeConsoleSpies();
    const error = new Error("mixed");

    createConsoleLogger().warn("prefix", { a: 1 }, error, 3);

    expect(spies.warn).toHaveBeenCalledWith(`[warn] prefix {"a":1} ${error.stack} 3`);
  });

  // FIXME(bug): zero-arg calls emit a prefix with a trailing space ("[info] ").
  // Asserting current behavior, not desired behavior.
  test("emits the bare prefix when called with no args", () => {
    const spies = makeConsoleSpies();

    createConsoleLogger().info();

    expect(spies.log).toHaveBeenCalledWith("[info] ");
  });
});
