jest.mock("../src/config", () => ({ loadConfig: jest.fn() }));
jest.mock("../src/runtime/registerHealthEndpoints", () => ({ registerHealthEndpoints: jest.fn() }));
jest.mock("../src/runtime/registerWebhookHandlers", () => ({ registerWebhookHandlers: jest.fn() }));

const { loadConfig } = require("../src/config");
const { registerHealthEndpoints } = require("../src/runtime/registerHealthEndpoints");
const { registerWebhookHandlers } = require("../src/runtime/registerWebhookHandlers");
const app = require("../src/app");

function makeApp() {
  return { log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };
}

/**
 * Captures the readiness object the module hands to registerHealthEndpoints,
 * plus the value it held AT CALL TIME (the same object is mutated afterwards).
 */
function captureReadiness() {
  const captured = { object: undefined, isReadyAtCallTime: undefined };

  registerHealthEndpoints.mockImplementation((addHandler, log, readiness) => {
    captured.object = readiness;
    captured.isReadyAtCallTime = readiness.isReady;
  });

  return captured;
}

afterEach(() => {
  jest.resetAllMocks();
});

describe("app", () => {
  test("logs the load message on the app logger", () => {
    const probot = makeApp();

    app(probot, { addHandler: jest.fn() });

    expect(probot.log.info).toHaveBeenCalledWith("PR Checker Bot loaded");
  });

  test("registers health endpoints with the supplied addHandler and app logger", () => {
    const probot = makeApp();
    const addHandler = jest.fn();

    app(probot, { addHandler });

    expect(registerHealthEndpoints).toHaveBeenCalledTimes(1);
    expect(registerHealthEndpoints).toHaveBeenCalledWith(addHandler, probot.log, { isReady: true });
  });

  test("forwards an undefined addHandler when called with no options argument", () => {
    const probot = makeApp();

    expect(() => app(probot)).not.toThrow();

    expect(registerHealthEndpoints).toHaveBeenCalledWith(undefined, probot.log, expect.any(Object));
    expect(registerHealthEndpoints.mock.calls[0][0]).toBeUndefined();
  });

  test("forwards an undefined addHandler when options omit the key", () => {
    const probot = makeApp();

    app(probot, {});

    expect(registerHealthEndpoints.mock.calls[0][0]).toBeUndefined();
  });

  test("loads config with the app logger and hands the result to registerWebhookHandlers", () => {
    const probot = makeApp();
    const config = { checks: { blockedLabels: { enabled: true } } };
    loadConfig.mockReturnValue(config);

    app(probot, { addHandler: jest.fn() });

    expect(loadConfig).toHaveBeenCalledWith(probot.log);
    expect(registerWebhookHandlers).toHaveBeenCalledTimes(1);
    expect(registerWebhookHandlers).toHaveBeenCalledWith(probot, config);
    expect(registerWebhookHandlers.mock.calls[0][1]).toBe(config);
  });

  test("forwards an undefined config when loadConfig returns nothing", () => {
    const probot = makeApp();
    loadConfig.mockReturnValue(undefined);

    app(probot, { addHandler: jest.fn() });

    expect(registerWebhookHandlers).toHaveBeenCalledWith(probot, undefined);
  });
});

describe("app readiness contract", () => {
  test("registers health endpoints before readiness flips to true", () => {
    const probot = makeApp();
    const captured = captureReadiness();

    app(probot, { addHandler: jest.fn() });

    expect(captured.isReadyAtCallTime).toBe(false);
    expect(captured.object.isReady).toBe(true);
  });

  test("registers health endpoints before loading config or wiring webhooks", () => {
    const probot = makeApp();

    app(probot, { addHandler: jest.fn() });

    expect(registerHealthEndpoints.mock.invocationCallOrder[0]).toBeLessThan(
      loadConfig.mock.invocationCallOrder[0]
    );
    expect(loadConfig.mock.invocationCallOrder[0]).toBeLessThan(
      registerWebhookHandlers.mock.invocationCallOrder[0]
    );
  });

  test("mutates the same readiness object it gave to the health endpoints", () => {
    const probot = makeApp();
    const captured = captureReadiness();

    app(probot, { addHandler: jest.fn() });

    expect(captured.object).toBe(registerHealthEndpoints.mock.calls[0][2]);
  });

  test("leaves readiness false and skips webhook wiring when loadConfig throws", () => {
    const probot = makeApp();
    const captured = captureReadiness();
    loadConfig.mockImplementation(() => {
      throw new Error("invalid config");
    });

    expect(() => app(probot, { addHandler: jest.fn() })).toThrow("invalid config");

    expect(captured.object.isReady).toBe(false);
    expect(registerWebhookHandlers).not.toHaveBeenCalled();
  });

  test("leaves readiness false when registerWebhookHandlers throws", () => {
    const probot = makeApp();
    const captured = captureReadiness();
    registerWebhookHandlers.mockImplementation(() => {
      throw new Error("cannot subscribe");
    });

    expect(() => app(probot, { addHandler: jest.fn() })).toThrow("cannot subscribe");

    expect(captured.object.isReady).toBe(false);
  });

  test("leaves readiness false when registerHealthEndpoints throws", () => {
    const probot = makeApp();
    const captured = captureReadiness();
    registerHealthEndpoints.mockImplementation((addHandler, log, readiness) => {
      captured.object = readiness;
      captured.isReadyAtCallTime = readiness.isReady;
      throw new Error("router unavailable");
    });

    expect(() => app(probot, { addHandler: jest.fn() })).toThrow("router unavailable");

    expect(captured.object.isReady).toBe(false);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  test("uses a fresh readiness object per invocation", () => {
    const probot = makeApp();

    app(probot, { addHandler: jest.fn() });
    app(probot, { addHandler: jest.fn() });

    const [firstReadiness] = registerHealthEndpoints.mock.calls[0].slice(2);
    const [secondReadiness] = registerHealthEndpoints.mock.calls[1].slice(2);
    expect(firstReadiness).not.toBe(secondReadiness);
  });
});

describe("app edge inputs", () => {
  test("throws when the options argument is null because only undefined triggers the default", () => {
    const probot = makeApp();

    expect(() => app(probot, null)).toThrow(TypeError);
    expect(registerHealthEndpoints).not.toHaveBeenCalled();
  });

  test("ignores unknown option keys", () => {
    const probot = makeApp();
    const addHandler = jest.fn();

    app(probot, { addHandler, getRouter: jest.fn(), cwd: "/srv" });

    expect(registerHealthEndpoints).toHaveBeenCalledWith(addHandler, probot.log, { isReady: true });
  });
});
