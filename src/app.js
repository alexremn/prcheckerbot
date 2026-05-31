/**
 * Hubstaff PR Bot - GitHub App for PR validation
 * Replacement for Peril-based Danger checks
 *
 * @param {import('probot').Probot} app
 */
const { loadConfig } = require("./config");
const { registerHealthEndpoints } = require("./runtime/registerHealthEndpoints");
const { registerWebhookHandlers } = require("./runtime/registerWebhookHandlers");

module.exports = (app, { addHandler } = {}) => {
  app.log.info("PR Checker Bot loaded");

  const config = loadConfig(app.log);
  registerHealthEndpoints(addHandler, app.log);
  registerWebhookHandlers(app, config);
};
