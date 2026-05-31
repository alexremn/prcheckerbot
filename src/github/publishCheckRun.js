function getCheckRunName(config) {
  return config && config.checkRun && config.checkRun.name ? config.checkRun.name : "PR Checker";
}

function buildSummary(results) {
  const { failures, warnings } = results;
  const passed = failures.length === 0;

  if (passed && warnings.length === 0) {
    return {
      passed,
      statusText: "All checks passed",
      summary: "✅ All PR checks passed!",
    };
  }

  let summary = "";

  if (failures.length > 0) {
    summary += "## Failures\n\n";
    summary += failures.join("\n");
    summary += "\n\n";
  }

  if (warnings.length > 0) {
    summary += "## Warnings\n\n";
    summary += warnings.join("\n");
    summary += "\n\n";
  }

  if (passed) {
    return {
      passed,
      statusText: `Passed with ${warnings.length} warning${warnings.length > 1 ? "s" : ""}`,
      summary: "✅ All required checks passed.\n\n" + summary,
    };
  }

  return {
    passed,
    statusText: `${failures.length} issue${failures.length > 1 ? "s" : ""} found`,
    summary,
  };
}

async function publishCheckRun(context, pr, results, config) {
  const checkRunName = getCheckRunName(config);
  const { owner, repo } = context.repo();
  const { passed, statusText, summary } = buildSummary(results);

  await context.octokit.rest.checks.create({
    owner,
    repo,
    name: checkRunName,
    head_sha: pr.head.sha,
    status: "completed",
    conclusion: passed ? "success" : "failure",
    output: {
      title: statusText,
      summary,
      text: `Checked PR #${pr.number} at ${new Date().toISOString()}`,
    },
  });

  context.log.info(`Check run created for PR #${pr.number}: ${passed ? "success" : "failure"}`);
}

async function publishErrorCheckRun(context, pr, error, config) {
  const checkRunName = getCheckRunName(config);
  const { owner, repo } = context.repo();
  const message = error && error.message ? error.message : String(error);

  await context.octokit.rest.checks.create({
    owner,
    repo,
    name: checkRunName,
    head_sha: pr.head.sha,
    status: "completed",
    conclusion: "failure",
    output: {
      title: "PR checker failed to run",
      summary: `## Internal error\n\nThe PR checker encountered an error and could not complete validation.\n\n\`\`\`\n${message}\n\`\`\`\n\nRe-run the check after the issue is resolved.`,
      text: `Checked PR #${pr.number} at ${new Date().toISOString()}`,
    },
  });
}

module.exports = {
  getCheckRunName,
  publishCheckRun,
  publishErrorCheckRun,
};
