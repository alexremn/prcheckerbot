const { evaluatePullRequest } = require("../engine/evaluatePullRequest");
const { publishCheckRun, publishErrorCheckRun } = require("../github/publishCheckRun");

async function runPrValidation(context, pr, config) {
  context.log.info(`Processing PR #${pr.number}: ${pr.title}`);

  let results;
  try {
    results = await evaluatePullRequest(context, pr, config);
  } catch (error) {
    context.log.error({ err: error }, `Evaluation failed for PR #${pr.number}`);
    try {
      await publishErrorCheckRun(context, pr, error, config);
    } catch (publishError) {
      context.log.error({ err: publishError }, `Failed to publish error check run for PR #${pr.number}`);
    }
    return;
  }

  await publishCheckRun(context, pr, results, config);
}

module.exports = {
  runPrValidation,
};
