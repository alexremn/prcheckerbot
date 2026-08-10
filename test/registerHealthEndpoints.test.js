const { registerHealthEndpoints } = require("../src/runtime/registerHealthEndpoints");

function makeRes() {
  const res = {
    writeHead: jest.fn(() => res),
    end: jest.fn(),
  };
  return res;
}

function makeLog() {
  return { warn: jest.fn() };
}

// Registers the endpoints and returns the handler that was passed to addHandler.
function captureHandler(log, state) {
  const addHandler = jest.fn();
  if (state === undefined) {
    registerHealthEndpoints(addHandler, log);
  } else {
    registerHealthEndpoints(addHandler, log, state);
  }
  expect(addHandler).toHaveBeenCalledTimes(1);
  return addHandler.mock.calls[0][0];
}

describe("registerHealthEndpoints registration", () => {
  test("registers exactly one handler when addHandler is a function", () => {
    const addHandler = jest.fn();
    const log = makeLog();

    registerHealthEndpoints(addHandler, log, { isReady: true });

    expect(addHandler).toHaveBeenCalledTimes(1);
    expect(typeof addHandler.mock.calls[0][0]).toBe("function");
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("warns and registers nothing when addHandler is not a function", () => {
    const log = makeLog();

    registerHealthEndpoints(undefined, log, { isReady: true });

    expect(log.warn).toHaveBeenCalledWith("addHandler unavailable; skipping health endpoints");
  });

  test("does not throw when addHandler is missing and log is undefined", () => {
    expect(() => registerHealthEndpoints(null, undefined, { isReady: true })).not.toThrow();
  });

  test("does not throw when addHandler is missing and log has no warn method", () => {
    const log = { info: jest.fn() };

    expect(() => registerHealthEndpoints({}, log, { isReady: true })).not.toThrow();
    expect(log.info).not.toHaveBeenCalled();
  });
});

describe("health handler routing", () => {
  test("returns false for non-GET requests without writing a response", () => {
    const handler = captureHandler(makeLog(), { isReady: true });
    const res = makeRes();

    const handled = handler({ method: "POST", url: "/healthz" }, res);

    expect(handled).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  test("returns false for unknown paths", () => {
    const handler = captureHandler(makeLog(), { isReady: true });
    const res = makeRes();

    const handled = handler({ method: "GET", url: "/metrics" }, res);

    expect(handled).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  test("returns false when req.url is undefined", () => {
    const handler = captureHandler(makeLog(), { isReady: true });
    const res = makeRes();

    const handled = handler({ method: "GET" }, res);

    expect(handled).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  test("returns false for an empty-string url", () => {
    const handler = captureHandler(makeLog(), { isReady: true });
    const res = makeRes();

    const handled = handler({ method: "GET", url: "" }, res);

    expect(handled).toBe(false);
  });
});

describe("/healthz", () => {
  test("responds 200 with ok status JSON", () => {
    const handler = captureHandler(makeLog(), { isReady: false });
    const res = makeRes();

    const handled = handler({ method: "GET", url: "/healthz" }, res);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, { "content-type": "application/json" });
    expect(res.end).toHaveBeenCalledWith('{"status":"ok"}');
  });

  test("ignores the query string when matching the path", () => {
    const handler = captureHandler(makeLog(), { isReady: true });
    const res = makeRes();

    const handled = handler({ method: "GET", url: "/healthz?verbose=1" }, res);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, { "content-type": "application/json" });
    expect(res.end).toHaveBeenCalledWith('{"status":"ok"}');
  });
});

describe("/readyz", () => {
  test("responds 200 ready when state.isReady is true", () => {
    const handler = captureHandler(makeLog(), { isReady: true });
    const res = makeRes();

    const handled = handler({ method: "GET", url: "/readyz" }, res);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, { "content-type": "application/json" });
    expect(res.end).toHaveBeenCalledWith('{"status":"ready"}');
  });

  test("responds 503 starting when state.isReady is false", () => {
    const handler = captureHandler(makeLog(), { isReady: false });
    const res = makeRes();

    const handled = handler({ method: "GET", url: "/readyz" }, res);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(503, { "content-type": "application/json" });
    expect(res.end).toHaveBeenCalledWith('{"status":"starting"}');
  });

  test("responds 503 starting when state.isReady is missing", () => {
    const handler = captureHandler(makeLog(), {});
    const res = makeRes();

    handler({ method: "GET", url: "/readyz" }, res);

    expect(res.writeHead).toHaveBeenCalledWith(503, { "content-type": "application/json" });
    expect(res.end).toHaveBeenCalledWith('{"status":"starting"}');
  });

  test("responds 200 ready when the state argument is omitted", () => {
    const handler = captureHandler(makeLog(), undefined);
    const res = makeRes();

    handler({ method: "GET", url: "/readyz" }, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, { "content-type": "application/json" });
    expect(res.end).toHaveBeenCalledWith('{"status":"ready"}');
  });

  test("reads readiness at request time, not at registration time", () => {
    const state = { isReady: false };
    const handler = captureHandler(makeLog(), state);
    const res = makeRes();

    state.isReady = true;
    handler({ method: "GET", url: "/readyz" }, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, { "content-type": "application/json" });
    expect(res.end).toHaveBeenCalledWith('{"status":"ready"}');
  });

  test("ignores the query string when matching the path", () => {
    const handler = captureHandler(makeLog(), { isReady: true });
    const res = makeRes();

    const handled = handler({ method: "GET", url: "/readyz?full=true" }, res);

    expect(handled).toBe(true);
    expect(res.end).toHaveBeenCalledWith('{"status":"ready"}');
  });
});
