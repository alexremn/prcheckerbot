async function loadPullRequest(context, pullNumber) {
  const { owner, repo } = context.repo();

  const response = await context.octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return response.data;
}

module.exports = {
  loadPullRequest,
};
