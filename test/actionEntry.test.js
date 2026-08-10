const mockRunAction = jest.fn();

jest.mock("../src/action/runAction", () => ({
  runAction: (...args) => mockRunAction(...args),
}));

// src/action.js is a bootstrap: requiring it runs it. Reset the registry so
// every test gets a fresh execution of the entry point.
function requireEntryPoint() {
  jest.resetModules();
  require("../src/action");
}

// The .catch() handler runs on a later turn of the event loop than require().
function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

let exitSpy;

beforeEach(() => {
  mockRunAction.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("action entry point", () => {
  test("invokes runAction once", async () => {
    mockRunAction.mockResolvedValue(undefined);

    requireEntryPoint();
    await flushAsync();

    expect(mockRunAction).toHaveBeenCalledTimes(1);
  });

  test("neither logs nor exits when runAction resolves", async () => {
    mockRunAction.mockResolvedValue(undefined);

    requireEntryPoint();
    await flushAsync();

    expect(console.error).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("logs the stack and exits 1 when runAction rejects with an Error", async () => {
    const error = new Error("boom");
    mockRunAction.mockRejectedValue(error);

    requireEntryPoint();
    await flushAsync();

    expect(console.error).toHaveBeenCalledWith("[fatal]", error.stack);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("logs the error itself when the rejected Error carries no stack", async () => {
    const error = new Error("boom");
    error.stack = undefined;
    mockRunAction.mockRejectedValue(error);

    requireEntryPoint();
    await flushAsync();

    expect(console.error).toHaveBeenCalledWith("[fatal]", error);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("logs a rejected string as-is and exits 1", async () => {
    mockRunAction.mockRejectedValue("kaboom");

    requireEntryPoint();
    await flushAsync();

    expect(console.error).toHaveBeenCalledWith("[fatal]", "kaboom");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("logs a rejected null and exits 1", async () => {
    mockRunAction.mockRejectedValue(null);

    requireEntryPoint();
    await flushAsync();

    expect(console.error).toHaveBeenCalledWith("[fatal]", null);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
