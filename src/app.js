/**
 * PR Checker Bot - GitHub App for PR validation
 * Replacement for Peril-based Danger checks
 *
 * @param {import('probot').Probot} app
 */
const { loadConfig } = require("./config");
const { registerHealthEndpoints } = require("./runtime/registerHealthEndpoints");
const { registerWebhookHandlers } = require("./runtime/registerWebhookHandlers");

module.exports = (app, { addHandler } = {}) => {
  app.log.info("PR Checker Bot loaded");

  // /readyz reports 503 until config is loaded and webhook handlers are wired.
  const readiness = { isReady: false };
  registerHealthEndpoints(addHandler, app.log, readiness);

  const config = loadConfig(app.log);
  registerWebhookHandlers(app, config);
  readiness.isReady = true;
};
