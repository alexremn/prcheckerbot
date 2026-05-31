const { run } = require("probot");
const pino = require("pino");
const app = require("./app");

// Ensure server binds to all interfaces (required for Kubernetes)
process.env.HOST = process.env.HOST || "0.0.0.0";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  name: "probot",
});

const originalChild = log.child.bind(log);
log.child = (bindings, options) => {
  const child = originalChild(bindings, options);
  if (bindings && bindings.name === "http") {
    child.level = process.env.HTTP_LOG_LEVEL || "warn";
  }
  return child;
};

run(app, { log });
