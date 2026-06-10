const { loadPullRequest } = require("../github/loadPullRequest");
const { getCheckRunName } = require("../github/publishCheckRun");
const { runPrValidation } = require("../workflow/runPrValidation");

const PULL_REQUEST_EVENTS = [
  "pull_request.opened",
  "pull_request.synchronize",
  "pull_request.reopened",
  "pull_request.labeled",
  "pull_request.unlabeled",
  "pull_request.edited",
];

const PULL_REQUEST_REVIEW_EVENTS = ["pull_request_review.submitted", "pull_request_review.dismissed"];

function registerWebhookHandlers(app, config) {
  const checkRunName = getCheckRunName(config);

  app.on(PULL_REQUEST_EVENTS, async (context) => {
    const pr = context.payload.pull_request;
    await runPrValidation(context, pr, config);
  });

  app.on(PULL_REQUEST_REVIEW_EVENTS, async (context) => {
    const reviewPayloadPr = context.payload.pull_request;
    const pr = await loadPullRequest(context, reviewPayloadPr.number);
    await runPrValidation(context, pr, config);
  });

  app.on("check_run.rerequested", async (context) => {
    const checkRun = context.payload.check_run;

    if (checkRun.name !== checkRunName) {
      return;
    }

    const pullRequests = Array.isArray(checkRun.pull_requests) ? checkRun.pull_requests : [];
    if (pullRequests.length === 0) {
      context.log.warn("No PR associated with this check run");
      return;
    }

    // A check run can be attached to several PRs (e.g. same head SHA) —
    // revalidate every one of them, not just the first.
    for (const pullRequestRef of pullRequests) {
      const pr = await loadPullRequest(context, pullRequestRef.number);
      await runPrValidation(context, pr, config);
    }
  });
}

module.exports = {
  registerWebhookHandlers,
};
