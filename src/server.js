const { Writable } = require("node:stream");
const { run } = require("probot");
const pino = require("pino");
const app = require("./app");

// Ensure server binds to all interfaces (required for Kubernetes)
process.env.HOST = process.env.HOST || "0.0.0.0";

// Kubernetes liveness/readiness probes hit these paths every few seconds.
// Their access logs are pure noise, so we drop them entirely.
const SILENCED_ACCESS_PATHS = new Set(["/healthz", "/readyz"]);

// Real client IP, preferring the proxy/ingress forwarded headers.
function clientIp(headers, remoteAddress) {
  const forwardedFor = headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return headers["x-real-ip"] || remoteAddress;
}

// Transform one parsed pino record into the NDJSON line we emit.
// Returns a string to write, or null to drop the record.
function formatRecord(record) {
  const req = record.req;

  // App-level log (no HTTP request attached). The JSON round-trip in the
  // destination already collapsed pino's duplicated chindings — e.g.
  // {name:probot, name:probot, name:event} parses to {name:event} — so we
  // just re-serialize the de-duplicated record.
  if (!req || typeof req.url !== "string") {
    return JSON.stringify(record);
  }

  const path = req.url.split("?")[0];
  if (SILENCED_ACCESS_PATHS.has(path)) {
    return null; // k8s probe noise
  }

  // HTTP access log: keep the useful fields, drop the verbose header dump.
  return JSON.stringify({
    level: record.level,
    time: record.time,
    pid: record.pid,
    hostname: record.hostname,
    name: record.name,
    reqId: req.id,
    method: req.method,
    url: req.url,
    status: record.res ? record.res.statusCode : undefined,
    responseTime: record.responseTime,
    ip: clientIp(req.headers || {}, req.remoteAddress),
    msg: record.msg,
  });
}

function emitLine(line) {
  let out;
  try {
    out = formatRecord(JSON.parse(line));
  } catch {
    out = line; // not JSON — forward verbatim
  }
  if (out != null) process.stdout.write(out + "\n");
}

// pino emits NDJSON; we reshape each record (de-dupe keys, trim access logs,
// drop probe noise) before forwarding to stdout. A record may be split across
// chunks, so the trailing partial line is buffered until its newline arrives —
// otherwise both halves would fail JSON.parse and leak through verbatim.
let pendingLine = "";
const destination = new Writable({
  write(chunk, _encoding, callback) {
    const lines = (pendingLine + chunk.toString()).split("\n");
    pendingLine = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      emitLine(line);
    }
    callback();
  },
  final(callback) {
    if (pendingLine) emitLine(pendingLine);
    pendingLine = "";
    callback();
  },
});

const log = pino(
  { level: process.env.LOG_LEVEL || "info", name: "probot" },
  destination,
);

run(app, { log });
