const { collectPullRequestData } = require("../github/prDataCollector");
const { isEnabled } = require("./helpers");
const { RULE_CATALOG } = require("./ruleCatalog");

function buildDerivedState(pr) {
  const labels = (pr.labels || []).map((label) => String(label.name || "").toLowerCase());

  return {
    labels,
    labelSet: new Set(labels),
    title: pr.title || "",
    body: pr.body || "",
    baseRef: String(pr && pr.base && pr.base.ref ? pr.base.ref : "").toLowerCase(),
    totalChanges: (pr.additions || 0) + (pr.deletions || 0),
  };
}

async function evaluatePullRequest(context, pr, config) {
  const checks = config && config.checks ? config.checks : {};
  const derived = buildDerivedState(pr);
  const data = await collectPullRequestData(context, pr, config);

  const failures = [];
  const warnings = [];

  for (const [checkName, rule] of Object.entries(RULE_CATALOG)) {
    const check = checks[checkName] || {};
    if (!isEnabled(check)) {
      continue;
    }

    const outcome = rule.run({
      check,
      checkName,
      context,
      data,
      derived,
      pr,
    });

    if (outcome && Array.isArray(outcome.failures) && outcome.failures.length > 0) {
      failures.push(...outcome.failures);
    }

    if (outcome && Array.isArray(outcome.warnings) && outcome.warnings.length > 0) {
      warnings.push(...outcome.warnings);
    }
  }

  return { failures, warnings };
}

module.exports = {
  evaluatePullRequest,
};
