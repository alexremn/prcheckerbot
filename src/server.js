const { run } = require("probot");
const app = require("./app");

// Ensure server binds to all interfaces (required for Kubernetes)
process.env.HOST = process.env.HOST || "0.0.0.0";

run(app);
