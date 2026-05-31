/**
 * Hubstaff PR Bot - GitHub App for PR validation
 * Replacement for Peril-based Danger checks
 *
 * @param {import('probot').Probot} app
 */
const { loadConfig } = require("./config");
const { registerHealthEndpoints } = require("./runtime/registerHealthEndpoints");
const { registerWebhookHandlers } = require("./runtime/registerWebhookHandlers");

module.exports = (app, { getRouter } = {}) => {
  app.log.info("PR Checker Bot loaded");

  const config = loadConfig(app.log);
  registerHealthEndpoints(getRouter, app.log);
  registerWebhookHandlers(app, config);
};
