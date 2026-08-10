const {
  SILENCED_ACCESS_PATHS,
  clientIp,
  createLogDestination,
  formatRecord,
} = require("../src/runtime/logFormatter");

describe("SILENCED_ACCESS_PATHS", () => {
  test("contains exactly the kubernetes probe paths", () => {
    expect([...SILENCED_ACCESS_PATHS].sort()).toEqual(["/healthz", "/readyz"]);
  });
});

describe("clientIp", () => {
  test("returns the first x-forwarded-for entry with whitespace trimmed", () => {
    const ip = clientIp(
      { "x-forwarded-for": "  203.0.113.5 , 10.0.0.1 ", "x-real-ip": "9.9.9.9" },
      "172.16.0.1",
    );

    expect(ip).toBe("203.0.113.5");
  });

  test("returns the whole x-forwarded-for value when it holds a single hop", () => {
    expect(clientIp({ "x-forwarded-for": "203.0.113.5" }, "172.16.0.1")).toBe("203.0.113.5");
  });

  test("falls back to x-real-ip when x-forwarded-for is an empty string", () => {
    expect(clientIp({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" }, "172.16.0.1")).toBe(
      "9.9.9.9",
    );
  });

  test("falls back to x-real-ip when x-forwarded-for is not a string", () => {
    expect(
      clientIp({ "x-forwarded-for": ["203.0.113.5"], "x-real-ip": "9.9.9.9" }, "172.16.0.1"),
    ).toBe("9.9.9.9");
  });

  test("falls back to remoteAddress when no forwarding headers are present", () => {
    expect(clientIp({}, "172.16.0.1")).toBe("172.16.0.1");
  });

  test("falls back to remoteAddress when x-real-ip is an empty string", () => {
    expect(clientIp({ "x-real-ip": "" }, "172.16.0.1")).toBe("172.16.0.1");
  });

  test("returns undefined when neither headers nor remoteAddress identify the client", () => {
    expect(clientIp({}, undefined)).toBeUndefined();
  });
});

function makeAccessRecord(overrides = {}) {
  return {
    level: 30,
    time: 1700000000000,
    pid: 42,
    hostname: "pod-abc",
    name: "http",
    msg: "request completed",
    responseTime: 12.5,
    req: {
      id: 7,
      method: "POST",
      url: "/api/github/webhooks",
      remoteAddress: "172.16.0.1",
      remotePort: 54321,
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1", host: "bot.example.com" },
    },
    res: { statusCode: 202, headers: { "content-type": "text/plain" } },
    ...overrides,
  };
}

const ACCESS_LOG_KEYS = [
  "level",
  "time",
  "pid",
  "hostname",
  "name",
  "reqId",
  "method",
  "url",
  "status",
  "responseTime",
  "ip",
  "msg",
];

describe("formatRecord", () => {
  test("re-serializes an app-level record that has no req", () => {
    const record = { level: 30, time: 1, name: "event", msg: "processing pull_request" };

    expect(formatRecord(record)).toBe(JSON.stringify(record));
  });

  test("re-serializes an app-level error record with its stack intact", () => {
    const record = { level: 50, err: { type: "Error", message: "boom", stack: "Error: boom\n at x" } };

    expect(JSON.parse(formatRecord(record))).toEqual(record);
  });

  test("treats a record whose req has no url as app-level", () => {
    const record = { level: 30, req: { id: 3, method: "GET" }, msg: "no url" };

    expect(formatRecord(record)).toBe(JSON.stringify(record));
  });

  test("treats a record whose req.url is not a string as app-level", () => {
    const record = { level: 30, req: { id: 3, url: 42 }, msg: "weird url" };

    expect(formatRecord(record)).toBe(JSON.stringify(record));
  });

  test("returns null for /healthz probe records", () => {
    expect(formatRecord(makeAccessRecord({ req: { url: "/healthz" } }))).toBeNull();
  });

  test("returns null for /readyz probe records", () => {
    expect(formatRecord(makeAccessRecord({ req: { url: "/readyz" } }))).toBeNull();
  });

  test("returns null for probe records carrying a query string", () => {
    expect(formatRecord(makeAccessRecord({ req: { url: "/healthz?verbose=1" } }))).toBeNull();
  });

  test("keeps a non-probe path whose prefix looks like a probe", () => {
    const line = formatRecord(makeAccessRecord({ req: { url: "/healthz-detail" } }));

    expect(JSON.parse(line).url).toBe("/healthz-detail");
  });

  test("keeps only the trimmed field set for access logs", () => {
    const line = formatRecord(makeAccessRecord());

    const parsed = JSON.parse(line);
    expect(Object.keys(parsed)).toEqual(ACCESS_LOG_KEYS);
    expect(parsed).toEqual({
      level: 30,
      time: 1700000000000,
      pid: 42,
      hostname: "pod-abc",
      name: "http",
      reqId: 7,
      method: "POST",
      url: "/api/github/webhooks",
      status: 202,
      responseTime: 12.5,
      ip: "203.0.113.5",
      msg: "request completed",
    });
  });

  test("reads the access log status from record.res.statusCode", () => {
    const line = formatRecord(makeAccessRecord({ res: { statusCode: 500 } }));

    expect(JSON.parse(line).status).toBe(500);
  });

  test("omits status when the record has no res", () => {
    const line = formatRecord(makeAccessRecord({ res: undefined }));

    const parsed = JSON.parse(line);
    expect(parsed).not.toHaveProperty("status");
    expect(parsed.url).toBe("/api/github/webhooks");
  });

  test("resolves the access log ip through the header precedence chain", () => {
    const line = formatRecord(
      makeAccessRecord({
        req: { url: "/x", headers: { "x-real-ip": "9.9.9.9" }, remoteAddress: "172.16.0.1" },
      }),
    );

    expect(JSON.parse(line).ip).toBe("9.9.9.9");
  });

  test("falls back to remoteAddress when the request carries no headers", () => {
    const line = formatRecord(makeAccessRecord({ req: { url: "/x", remoteAddress: "172.16.0.1" } }));

    expect(JSON.parse(line).ip).toBe("172.16.0.1");
  });
});

function makeDestination() {
  const write = jest.fn();
  return { write, dest: createLogDestination(write) };
}

// Ends the stream and resolves once `final()` has flushed.
function endDestination(dest) {
  return new Promise((resolve, reject) => {
    dest.end((err) => (err ? reject(err) : resolve()));
  });
}

const APP_RECORD = { level: 30, name: "event", msg: "hello" };
const APP_LINE = JSON.stringify(APP_RECORD);

describe("createLogDestination", () => {
  test("emits one formatted line per NDJSON record in a chunk", async () => {
    const { write, dest } = makeDestination();
    const second = { level: 40, name: "event", msg: "warn" };

    dest.write(`${APP_LINE}\n${JSON.stringify(second)}\n`);
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${APP_LINE}\n`], [`${JSON.stringify(second)}\n`]]);
  });

  test("joins a record split across two chunk writes into one emitted line", async () => {
    const { write, dest } = makeDestination();
    const half = APP_LINE.slice(0, 12);

    dest.write(half);
    expect(write).not.toHaveBeenCalled();
    dest.write(`${APP_LINE.slice(12)}\n`);
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${APP_LINE}\n`]]);
  });

  test("accepts Buffer chunks", async () => {
    const { write, dest } = makeDestination();

    dest.write(Buffer.from(`${APP_LINE}\n`));
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${APP_LINE}\n`]]);
  });

  // Regression guard: chunk.toString() decoded each half independently, so a
  // multi-byte character straddling the boundary became U+FFFD in both halves
  // and the character was lost from the rejoined line.
  test("preserves a multi-byte character split across a chunk boundary", async () => {
    const { write, dest } = makeDestination();
    const record = { level: 30, name: "event", msg: "Fix: café ☕ done" };
    const buffer = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    // Cut one byte into the 3-byte ☕ so its bytes land in different writes.
    const cut = buffer.indexOf(Buffer.from("☕", "utf8")) + 1;

    dest.write(buffer.subarray(0, cut));
    dest.write(buffer.subarray(cut));
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${JSON.stringify(record)}\n`]]);
    expect(JSON.parse(write.mock.calls[0][0]).msg).toBe("Fix: café ☕ done");
  });

  test("flushes a trailing multi-byte character held back by the decoder", async () => {
    const { write, dest } = makeDestination();
    const record = { level: 30, name: "event", msg: "☕" };
    const buffer = Buffer.from(JSON.stringify(record), "utf8"); // no trailing newline

    dest.write(buffer);
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${JSON.stringify(record)}\n`]]);
  });

  test("skips blank lines", async () => {
    const { write, dest } = makeDestination();

    dest.write(`\n\n${APP_LINE}\n\n`);
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${APP_LINE}\n`]]);
  });

  test("forwards non-JSON garbage verbatim", async () => {
    const { write, dest } = makeDestination();

    dest.write("not json at all\n");
    await endDestination(dest);

    expect(write.mock.calls).toEqual([["not json at all\n"]]);
  });

  test("forwards a bare null record verbatim", async () => {
    const { write, dest } = makeDestination();

    dest.write("null\n");
    await endDestination(dest);

    expect(write.mock.calls).toEqual([["null\n"]]);
  });

  test("drops silenced probe access logs", async () => {
    const { write, dest } = makeDestination();
    const probe = makeAccessRecord({ req: { url: "/readyz" } });

    dest.write(`${JSON.stringify(probe)}\n${APP_LINE}\n`);
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${APP_LINE}\n`]]);
  });

  test("trims access log records passing through the stream", async () => {
    const { write, dest } = makeDestination();

    dest.write(`${JSON.stringify(makeAccessRecord())}\n`);
    await endDestination(dest);

    expect(write).toHaveBeenCalledTimes(1);
    const emitted = write.mock.calls[0][0];
    expect(emitted.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(emitted))).toEqual(ACCESS_LOG_KEYS);
  });

  test("flushes a trailing partial line that never got its newline", async () => {
    const { write, dest } = makeDestination();

    dest.write(APP_LINE);
    await endDestination(dest);

    expect(write.mock.calls).toEqual([[`${APP_LINE}\n`]]);
  });

  test("emits nothing on end when the buffer is empty", async () => {
    const { write, dest } = makeDestination();

    dest.write(`${APP_LINE}\n`);
    await endDestination(dest);

    expect(write).toHaveBeenCalledTimes(1);
  });

  test("emits nothing when the stream ends without any write", async () => {
    const { write, dest } = makeDestination();

    await endDestination(dest);

    expect(write).not.toHaveBeenCalled();
  });

  test("keeps line buffers isolated between destinations", async () => {
    const first = makeDestination();
    const second = makeDestination();

    first.dest.write(APP_LINE.slice(0, 10));
    second.dest.write(`${APP_LINE}\n`);
    await endDestination(second.dest);
    await endDestination(first.dest);

    expect(second.write.mock.calls).toEqual([[`${APP_LINE}\n`]]);
    expect(first.write.mock.calls).toEqual([[APP_LINE.slice(0, 10) + "\n"]]);
  });
});

describe("createLogDestination default sink", () => {
  let stdoutWrite;

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  test("writes to process.stdout when no write function is injected", async () => {
    stdoutWrite = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dest = createLogDestination();

    dest.write(`${APP_LINE}\n`);
    await endDestination(dest);

    expect(stdoutWrite).toHaveBeenCalledWith(`${APP_LINE}\n`);
  });
});
