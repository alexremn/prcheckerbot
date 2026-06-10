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

  // paginate() walks every page — rules must see ALL commits/files/reviews,
  // otherwise e.g. sensitiveFiles silently misses files beyond the first page.
  const [commits, files, compareResult, reviews] = await Promise.all([
    requiredData.has("commits")
      ? octokit.paginate(octokit.rest.pulls.listCommits, {
          owner,
          repo,
          pull_number: pr.number,
          per_page: perPage,
        })
      : Promise.resolve([]),

    requiredData.has("files")
      ? octokit.paginate(octokit.rest.pulls.listFiles, {
          owner,
          repo,
          pull_number: pr.number,
          per_page: perPage,
        })
      : Promise.resolve([]),

    requiredData.has("compare")
      ? octokit.rest.repos.compareCommits({
          owner,
          repo,
          base: qualifyRef(pr.base, owner),
          head: qualifyRef(pr.head, owner),
          // behind_by is in the response metadata; we don't need the commit list.
          per_page: 1,
        })
      : Promise.resolve({ data: { behind_by: 0 } }),

    requiredData.has("reviews")
      ? octokit.paginate(octokit.rest.pulls.listReviews, {
          owner,
          repo,
          pull_number: pr.number,
          per_page: perPage,
        })
      : Promise.resolve([]),
  ]);

  return {
    commits,
    files,
    compare: compareResult.data,
    reviews,
  };
}

module.exports = {
  collectPullRequestData,
};
