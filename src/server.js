const { Writable } = require("node:stream");
const { run } = require("probot");
const pino = require("pino");
const app = require("./app");

// Ensure server binds to all interfaces (required for Kubernetes)
process.env.HOST = process.env.HOST || "0.0.0.0";

// Kubernetes liveness/readiness probes hit these paths every few seconds.
// Their access logs are pure noise, so we drop them at the log destination.
const SILENCED_ACCESS_PATHS = new Set(["/healthz", "/readyz"]);

// pino emits one NDJSON record per write(); drop probe access logs, pass the
// rest straight through to stdout untouched.
const destination = new Writable({
  write(chunk, _encoding, callback) {
    let drop = false;
    try {
      const record = JSON.parse(chunk.toString());
      const url =
        record.req && typeof record.req.url === "string"
          ? record.req.url.split("?")[0]
          : null;
      drop = url !== null && SILENCED_ACCESS_PATHS.has(url);
    } catch {
      // Not JSON (shouldn't happen) — never drop.
    }
    if (!drop) process.stdout.write(chunk);
    callback();
  },
});

const log = pino(
  { level: process.env.LOG_LEVEL || "info", name: "probot" },
  destination,
);

run(app, { log });
