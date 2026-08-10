const { loadPullRequest } = require("../src/github/loadPullRequest");

function makeContext(getImpl) {
  return {
    octokit: { rest: { pulls: { get: jest.fn(getImpl) } } },
    repo: jest.fn(() => ({ owner: "acme", repo: "widgets" })),
  };
}

describe("loadPullRequest", () => {
  test("requests the pull request with owner and repo resolved from context.repo()", async () => {
    const context = makeContext(async () => ({ data: { number: 7 } }));

    await loadPullRequest(context, 7);

    expect(context.repo).toHaveBeenCalledTimes(1);
    expect(context.octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 7,
    });
  });

  test("returns only the data payload of the octokit response", async () => {
    const data = { number: 7, title: "Add feature", additions: 12, deletions: 3 };
    const context = makeContext(async () => ({ data, status: 200, headers: {} }));

    const result = await loadPullRequest(context, 7);

    expect(result).toBe(data);
  });

  test("returns null when the response carries a null data payload", async () => {
    const context = makeContext(async () => ({ data: null }));

    const result = await loadPullRequest(context, 7);

    expect(result).toBeNull();
  });

  test("returns undefined when the response has no data property", async () => {
    const context = makeContext(async () => ({}));

    const result = await loadPullRequest(context, 7);

    expect(result).toBeUndefined();
  });

  test("forwards an undefined pull number unchanged to octokit", async () => {
    const context = makeContext(async () => ({ data: {} }));

    await loadPullRequest(context, undefined);

    expect(context.octokit.rest.pulls.get).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: undefined })
    );
  });

  test("forwards empty-string owner and repo unchanged to octokit", async () => {
    const context = makeContext(async () => ({ data: {} }));
    context.repo = jest.fn(() => ({ owner: "", repo: "" }));

    await loadPullRequest(context, 7);

    expect(context.octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "",
      repo: "",
      pull_number: 7,
    });
  });

  test("propagates a rejected octokit request", async () => {
    const notFound = new Error("Not Found");
    notFound.status = 404;
    const context = makeContext(async () => {
      throw notFound;
    });

    await expect(loadPullRequest(context, 7)).rejects.toBe(notFound);
  });

  test("propagates a throw from context.repo() without calling octokit", async () => {
    const context = makeContext(async () => ({ data: {} }));
    context.repo = jest.fn(() => {
      throw new Error("no repository in payload");
    });

    await expect(loadPullRequest(context, 7)).rejects.toThrow("no repository in payload");
    expect(context.octokit.rest.pulls.get).not.toHaveBeenCalled();
  });
});
