const fs = require("node:fs");
const { Octokit } = require("@octokit/rest");

const { loadConfig } = require("./config");
const { evaluatePullRequest } = require("./engine/evaluatePullRequest");
const { loadPullRequest } = require("./github/loadPullRequest");
const { publishCheckRun, publishErrorCheckRun } = require("./github/publishCheckRun");
const { buildActionContext, createConsoleLogger } = require("./action/buildActionContext");

const SUPPORTED_EVENTS = new Set([
  "pull_request",
  "pull_request_target",
  "pull_request_review",
]);

function readEnv(name) {
  const value = process.env[name];
  return value && value.length > 0 ? value : "";
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
}

function applyActionOverrides(config) {
  const checkRunName = readEnv("INPUT_CHECK_RUN_NAME");
  if (checkRunName) {
    config.checkRun = { ...(config.checkRun || {}), name: checkRunName };
  }

  const configPath = readEnv("INPUT_CONFIG_PATH");
  if (configPath) {
    process.env.PR_CHECKER_CONFIG_PATH = configPath;
  }
}

function writeOutputs(results) {
  const outputPath = readEnv("GITHUB_OUTPUT");
  if (!outputPath) {
    return;
  }

  const passed = results.failures.length === 0;
  const lines = [
    `passed=${passed}`,
    `failure-count=${results.failures.length}`,
    `warning-count=${results.warnings.length}`,
  ].join("\n");

  fs.appendFileSync(outputPath, `${lines}\n`);
}

function writeStepSummary(results) {
  const summaryPath = readEnv("GITHUB_STEP_SUMMARY");
  if (!summaryPath) {
    return;
  }

  const { failures, warnings } = results;
  let body = "# PR Checker\n\n";

  if (failures.length === 0 && warnings.length === 0) {
    body += "✅ All PR checks passed.\n";
  } else {
    if (failures.length > 0) {
      body += "## Failures\n\n";
      body += failures.map((line) => `- ${line}`).join("\n");
      body += "\n\n";
    }
    if (warnings.length > 0) {
      body += "## Warnings\n\n";
      body += warnings.map((line) => `- ${line}`).join("\n");
      body += "\n\n";
    }
  }

  fs.appendFileSync(summaryPath, body);
}

function fail(log, message, code) {
  log.error(message);
  process.exit(code || 2);
}

async function main() {
  const log = createConsoleLogger();

  const eventName = readEnv("GITHUB_EVENT_NAME");
  if (!SUPPORTED_EVENTS.has(eventName)) {
    log.warn(`Event "${eventName}" is not supported; nothing to do.`);
    return;
  }

  const token = readEnv("INPUT_GITHUB_TOKEN") || readEnv("GITHUB_TOKEN");
  if (!token) {
    fail(log, "Missing github-token / GITHUB_TOKEN");
  }

  const eventPath = readEnv("GITHUB_EVENT_PATH");
  if (!eventPath) {
    fail(log, "Missing GITHUB_EVENT_PATH (must run inside GitHub Actions)");
  }

  const repository = readEnv("GITHUB_REPOSITORY");
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    fail(log, `Invalid GITHUB_REPOSITORY: "${repository}"`);
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const octokit = new Octokit({ auth: token, userAgent: "github-prchecker-action" });

  applyActionOverrides({});
  const config = loadConfig(log);
  applyActionOverrides(config);

  const context = buildActionContext({ octokit, log, owner, repo, payload });

  let pr = payload.pull_request;
  if (!pr) {
    fail(log, `No pull_request found in event payload for "${eventName}"`);
  }

  if (eventName === "pull_request_review" || !Number.isFinite(pr.additions)) {
    pr = await loadPullRequest(context, pr.number);
  }

  const failOnFailure = parseBool(readEnv("INPUT_FAIL_ON_FAILURE"), true);

  let results;
  try {
    results = await evaluatePullRequest(context, pr, config);
  } catch (error) {
    log.error({ err: error }, `Evaluation failed for PR #${pr.number}`);
    try {
      await publishErrorCheckRun(context, pr, error, config);
    } catch (publishError) {
      log.error({ err: publishError }, `Failed to publish error check run for PR #${pr.number}`);
    }
    process.exit(failOnFailure ? 1 : 0);
  }

  await publishCheckRun(context, pr, results, config);
  writeOutputs(results);
  writeStepSummary(results);

  if (results.failures.length > 0 && failOnFailure) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[fatal]", error && error.stack ? error.stack : error);
  process.exit(1);
});
