const { run } = require("probot");
const pino = require("pino");
const app = require("./app");
const { createLogDestination } = require("./runtime/logFormatter");

// Ensure server binds to all interfaces (required for Kubernetes)
process.env.HOST = process.env.HOST || "0.0.0.0";

const log = pino(
  { level: process.env.LOG_LEVEL || "info", name: "probot" },
  createLogDestination(),
);

run(app, { log });
