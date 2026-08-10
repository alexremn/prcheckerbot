const mockRun = jest.fn();
const mockPino = jest.fn(() => ({ level: "mock-logger" }));
const mockCreateLogDestination = jest.fn(() => "DESTINATION_SENTINEL");

jest.mock("probot", () => ({ run: (...args) => mockRun(...args) }));
jest.mock("pino", () => (...args) => mockPino(...args));
jest.mock("../src/app", () => "APP_SENTINEL");
jest.mock("../src/runtime/logFormatter", () => ({
  createLogDestination: (...args) => mockCreateLogDestination(...args),
}));

const ORIGINAL_ENV = process.env;

// Re-executes src/server.js top-level side effects under a controlled env.
function loadServer(env = {}) {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.HOST;
  delete process.env.LOG_LEVEL;
  Object.assign(process.env, env);

  jest.resetModules();
  require("../src/server");
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.clearAllMocks();
});

describe("HOST binding", () => {
  test("defaults to 0.0.0.0 when HOST is unset", () => {
    loadServer();

    expect(process.env.HOST).toBe("0.0.0.0");
  });

  test("preserves an explicitly configured HOST", () => {
    loadServer({ HOST: "127.0.0.1" });

    expect(process.env.HOST).toBe("127.0.0.1");
  });

  test("falls back to 0.0.0.0 when HOST is an empty string", () => {
    loadServer({ HOST: "" });

    expect(process.env.HOST).toBe("0.0.0.0");
  });
});

describe("logger construction", () => {
  test("uses LOG_LEVEL when set", () => {
    loadServer({ LOG_LEVEL: "debug" });

    expect(mockPino).toHaveBeenCalledWith(
      { level: "debug", name: "probot" },
      "DESTINATION_SENTINEL",
    );
  });

  test("defaults level to info when LOG_LEVEL is unset", () => {
    loadServer();

    expect(mockPino).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info" }),
      expect.anything(),
    );
  });

  test("defaults level to info when LOG_LEVEL is an empty string", () => {
    loadServer({ LOG_LEVEL: "" });

    expect(mockPino).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info" }),
      expect.anything(),
    );
  });

  test("builds a fresh log destination with no arguments", () => {
    loadServer();

    expect(mockCreateLogDestination).toHaveBeenCalledTimes(1);
    expect(mockCreateLogDestination).toHaveBeenCalledWith();
  });
});

describe("probot bootstrap", () => {
  test("runs the app module with the constructed logger", () => {
    loadServer();

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith("APP_SENTINEL", {
      log: mockPino.mock.results[0].value,
    });
  });

  test("sets HOST before probot run is invoked", () => {
    mockRun.mockImplementationOnce(() => {
      expect(process.env.HOST).toBe("0.0.0.0");
    });

    loadServer();

    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
