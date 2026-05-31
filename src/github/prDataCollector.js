const { RULE_CATALOG } = require("../engine/ruleCatalog");
const { asNumber, isEnabled } = require("../engine/helpers");

function qualifyRef(side, baseOwner) {
  const ref = side && side.ref ? side.ref : "";
  const ownerLogin =
    side && side.repo && side.repo.owner && side.repo.owner.login ? side.repo.owner.login : baseOwner;

  if (!ownerLogin || ownerLogin === baseOwner) {
    return ref;
  }

  return `${ownerLogin}:${ref}`;
}

function getRequiredDataKinds(checks) {
  const required = new Set();

  for (const [checkName, rule] of Object.entries(RULE_CATALOG)) {
    const checkConfig = checks[checkName] || {};
    if (!isEnabled(checkConfig)) {
      continue;
    }

    for (const dataKind of rule.requiredData) {
      required.add(dataKind);
    }
  }

  return required;
}

async function collectPullRequestData(context, pr, config) {
  const checks = config && config.checks ? config.checks : {};
  const requiredData = getRequiredDataKinds(checks);

  const { owner, repo } = context.repo();
  const perPage = asNumber(config && config.api && config.api.listPerPage, 100);
  const octokit = context.octokit;

  const [commitsResult, filesResult, compareResult, reviewsResult] = await Promise.all([
    requiredData.has("commits")
      ? octokit.rest.pulls.listCommits({
          owner,
          repo,
          pull_number: pr.number,
          per_page: perPage,
        })
      : Promise.resolve({ data: [] }),

    requiredData.has("files")
      ? octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: pr.number,
          per_page: perPage,
        })
      : Promise.resolve({ data: [] }),

    requiredData.has("compare")
      ? octokit.rest.repos.compareCommits({
          owner,
          repo,
          base: qualifyRef(pr.head, owner),
          head: qualifyRef(pr.base, owner),
        })
      : Promise.resolve({ data: { ahead_by: 0 } }),

    requiredData.has("reviews")
      ? octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: pr.number,
          per_page: perPage,
        })
      : Promise.resolve({ data: [] }),
  ]);

  return {
    commits: commitsResult.data,
    files: filesResult.data,
    compare: compareResult.data,
    reviews: reviewsResult.data,
  };
}

module.exports = {
  collectPullRequestData,
};
