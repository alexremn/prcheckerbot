const { evaluatePullRequest } = require("../src/engine/evaluatePullRequest");

function makeContext() {
  const octokit = {
    paginate: jest.fn().mockResolvedValue([]),
    rest: {
      pulls: {
        listCommits: jest.fn(),
        listFiles: jest.fn(),
        listReviews: jest.fn(),
      },
      repos: {
        compareCommits: jest.fn().mockResolvedValue({ data: { behind_by: 0 } }),
      },
    },
  };

  return {
    octokit,
    log: { info: jest.fn(), warn: jest.fn() },
    repo: () => ({ owner: "acme", repo: "widgets" }),
  };
}

function makePr(overrides = {}) {
  return {
    number: 42,
    title: "feat: add feature",
    body: "A meaningful description.",
    labels: [{ name: "enhancement" }],
    base: { ref: "main" },
    head: { ref: "feature", repo: { owner: { login: "acme" } } },
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

describe("evaluatePullRequest", () => {
  test("aggregates failures from enabled checks", async () => {
    const context = makeContext();
    const pr = makePr({ labels: [], body: "" });
    const config = {
      checks: {
        labelsRequired: { enabled: true, minCount: 1 },
        descriptionRequired: { enabled: true, minLength: 5 },
        minApprovals: { enabled: false },
      },
    };

    const { failures, warnings } = await evaluatePullRequest(context, pr, config);

    expect(failures).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  test("skips disabled checks", async () => {
    const context = makeContext();
    const pr = makePr({ labels: [] });
    const config = { checks: { labelsRequired: { enabled: false }, minApprovals: { enabled: false } } };

    const { failures } = await evaluatePullRequest(context, pr, config);

    expect(failures).toHaveLength(0);
  });

  test("checks with no config entry run with rule defaults", async () => {
    const context = makeContext();
    const pr = makePr({ labels: [] });

    const { failures } = await evaluatePullRequest(context, pr, { checks: {} });

    expect(failures).toContain("❌ Please add labels to this PR");
  });

  test("does not call GitHub data endpoints when no enabled rule needs them", async () => {
    const context = makeContext();
    const config = {
      checks: {
        labelsRequired: { enabled: true },
        wipCommitMessages: { enabled: false },
        mergeCommits: { enabled: false },
        fixupCommits: { enabled: false },
        meaningfulCommitMessages: { enabled: false },
        minApprovals: { enabled: false },
        branchUpToDate: { enabled: false },
        sensitiveFiles: { enabled: false },
      },
    };

    await evaluatePullRequest(context, makePr(), config);

    expect(context.octokit.paginate).not.toHaveBeenCalled();
    expect(context.octokit.rest.repos.compareCommits).not.toHaveBeenCalled();
  });

  test("paginates commits when a commit rule is enabled", async () => {
    const context = makeContext();
    context.octokit.paginate.mockResolvedValue([{ commit: { message: "wip stuff" } }]);
    const config = {
      checks: {
        labelsRequired: { enabled: false },
        descriptionRequired: { enabled: false },
        titlePatternBlock: { enabled: false },
        wipCommitMessages: { enabled: true },
        mergeCommits: { enabled: false },
        fixupCommits: { enabled: false },
        meaningfulCommitMessages: { enabled: false },
        sensitiveInfoInBody: { enabled: false },
      },
    };

    const { failures } = await evaluatePullRequest(context, makePr(), config);

    expect(context.octokit.paginate).toHaveBeenCalledWith(
      context.octokit.rest.pulls.listCommits,
      expect.objectContaining({ owner: "acme", repo: "widgets", pull_number: 42 })
    );
    expect(failures).toContain("❌ PR is a Work in Progress (commit message contains 'WIP')");
  });

  test("compares base to head and reads behind_by", async () => {
    const context = makeContext();
    context.octokit.rest.repos.compareCommits.mockResolvedValue({ data: { behind_by: 9 } });
    const config = {
      checks: {
        labelsRequired: { enabled: false },
        descriptionRequired: { enabled: false },
        titlePatternBlock: { enabled: false },
        sensitiveInfoInBody: { enabled: false },
        minApprovals: { enabled: false },
        branchUpToDate: { enabled: true, maxCommitsBehind: 5 },
      },
    };

    const { failures } = await evaluatePullRequest(context, makePr(), config);

    expect(context.octokit.rest.repos.compareCommits).toHaveBeenCalledWith(
      expect.objectContaining({ base: "main", head: "feature" })
    );
    expect(failures[0]).toContain("9 commits behind main");
  });

  test("qualifies head ref with owner for fork PRs", async () => {
    const context = makeContext();
    const pr = makePr({ head: { ref: "feature", repo: { owner: { login: "forker" } } } });
    const config = {
      checks: {
        labelsRequired: { enabled: false },
        descriptionRequired: { enabled: false },
        titlePatternBlock: { enabled: false },
        sensitiveInfoInBody: { enabled: false },
        branchUpToDate: { enabled: true },
      },
    };

    await evaluatePullRequest(context, pr, config);

    expect(context.octokit.rest.repos.compareCommits).toHaveBeenCalledWith(
      expect.objectContaining({ base: "main", head: "forker:feature" })
    );
  });
});
