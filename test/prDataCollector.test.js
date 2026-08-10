const { collectPullRequestData } = require("../src/github/prDataCollector");
const { RULE_CATALOG } = require("../src/engine/ruleCatalog");

function makeContext(repoSlug = { owner: "acme", repo: "widgets" }) {
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
    repo: () => repoSlug,
  };
}

function makePr(overrides = {}) {
  return {
    number: 42,
    base: { ref: "main", repo: { owner: { login: "acme" } } },
    head: { ref: "feature", repo: { owner: { login: "acme" } } },
    ...overrides,
  };
}

function checksEnablingOnly(...enabledCheckNames) {
  const checks = {};

  for (const checkName of Object.keys(RULE_CATALOG)) {
    checks[checkName] = { enabled: enabledCheckNames.includes(checkName) };
  }

  return checks;
}

function paginatedEndpoints(octokit) {
  return octokit.paginate.mock.calls.map((call) => call[0]);
}

describe("collectPullRequestData required data kinds", () => {
  test("calls no endpoint and defaults compare when every check is disabled", async () => {
    const context = makeContext();

    const data = await collectPullRequestData(context, makePr(), { checks: checksEnablingOnly() });

    expect(context.octokit.paginate).not.toHaveBeenCalled();
    expect(context.octokit.rest.repos.compareCommits).not.toHaveBeenCalled();
    expect(data).toEqual({ commits: [], files: [], compare: { behind_by: 0 }, reviews: [] });
  });

  test("fetches only commits when a commit rule is enabled", async () => {
    const context = makeContext();
    context.octokit.paginate.mockResolvedValue([{ commit: { message: "feat: add" } }]);

    const data = await collectPullRequestData(context, makePr(), {
      checks: checksEnablingOnly("wipCommitMessages"),
    });

    expect(paginatedEndpoints(context.octokit)).toEqual([context.octokit.rest.pulls.listCommits]);
    expect(context.octokit.rest.repos.compareCommits).not.toHaveBeenCalled();
    expect(data.commits).toEqual([{ commit: { message: "feat: add" } }]);
    expect(data.files).toEqual([]);
    expect(data.reviews).toEqual([]);
    expect(data.compare).toEqual({ behind_by: 0 });
  });

  test("fetches only files when sensitiveFiles is enabled", async () => {
    const context = makeContext();
    context.octokit.paginate.mockResolvedValue([{ filename: "id_rsa" }]);

    const data = await collectPullRequestData(context, makePr(), {
      checks: checksEnablingOnly("sensitiveFiles"),
    });

    expect(paginatedEndpoints(context.octokit)).toEqual([context.octokit.rest.pulls.listFiles]);
    expect(context.octokit.rest.repos.compareCommits).not.toHaveBeenCalled();
    expect(data.files).toEqual([{ filename: "id_rsa" }]);
    expect(data.commits).toEqual([]);
    expect(data.reviews).toEqual([]);
  });

  test("fetches only reviews when minApprovals is enabled", async () => {
    const context = makeContext();
    context.octokit.paginate.mockResolvedValue([{ state: "APPROVED", user: { login: "ann" } }]);

    const data = await collectPullRequestData(context, makePr(), {
      checks: checksEnablingOnly("minApprovals"),
    });

    expect(paginatedEndpoints(context.octokit)).toEqual([context.octokit.rest.pulls.listReviews]);
    expect(context.octokit.rest.repos.compareCommits).not.toHaveBeenCalled();
    expect(data.reviews).toEqual([{ state: "APPROVED", user: { login: "ann" } }]);
    expect(data.commits).toEqual([]);
    expect(data.files).toEqual([]);
  });

  test("compares base to head with per_page 1 when branchUpToDate is enabled", async () => {
    const context = makeContext();
    context.octokit.rest.repos.compareCommits.mockResolvedValue({ data: { behind_by: 3 } });

    const data = await collectPullRequestData(context, makePr(), {
      checks: checksEnablingOnly("branchUpToDate"),
    });

    expect(context.octokit.paginate).not.toHaveBeenCalled();
    expect(context.octokit.rest.repos.compareCommits).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      base: "main",
      head: "feature",
      per_page: 1,
    });
    expect(data.compare).toEqual({ behind_by: 3 });
  });

  test("paginates every list endpoint when all data kinds are required", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), {
      checks: checksEnablingOnly("wipCommitMessages", "sensitiveFiles", "minApprovals", "branchUpToDate"),
    });

    expect(paginatedEndpoints(context.octokit)).toEqual([
      context.octokit.rest.pulls.listCommits,
      context.octokit.rest.pulls.listFiles,
      context.octokit.rest.pulls.listReviews,
    ]);
    expect(context.octokit.rest.repos.compareCommits).toHaveBeenCalledTimes(1);
  });
});

describe("collectPullRequestData ref qualification", () => {
  function compareArgs(context) {
    return context.octokit.rest.repos.compareCommits.mock.calls[0][0];
  }

  async function collectWithCompare(context, pr) {
    await collectPullRequestData(context, pr, { checks: checksEnablingOnly("branchUpToDate") });
    return compareArgs(context);
  }

  test("uses the bare ref when head lives in the same owner's repo", async () => {
    const context = makeContext();

    const args = await collectWithCompare(context, makePr());

    expect(args.head).toBe("feature");
  });

  test("prefixes the head ref with the fork owner", async () => {
    const context = makeContext();
    const pr = makePr({ head: { ref: "feature", repo: { owner: { login: "forker" } } } });

    const args = await collectWithCompare(context, pr);

    expect(args.head).toBe("forker:feature");
    expect(args.base).toBe("main");
  });

  test("falls back to the base owner when head carries no repo", async () => {
    const context = makeContext();
    const pr = makePr({ head: { ref: "feature" } });

    const args = await collectWithCompare(context, pr);

    expect(args.head).toBe("feature");
  });

  test("falls back to the base owner when the head repo has no owner", async () => {
    const context = makeContext();
    const pr = makePr({ head: { ref: "feature", repo: {} } });

    const args = await collectWithCompare(context, pr);

    expect(args.head).toBe("feature");
  });

  test("falls back to the base owner when the head repo owner has no login", async () => {
    const context = makeContext();
    const pr = makePr({ head: { ref: "feature", repo: { owner: {} } } });

    const args = await collectWithCompare(context, pr);

    expect(args.head).toBe("feature");
  });

  test("yields an empty ref when a side is missing entirely", async () => {
    const context = makeContext();
    const pr = makePr({ base: undefined, head: undefined });

    const args = await collectWithCompare(context, pr);

    expect(args.base).toBe("");
    expect(args.head).toBe("");
  });

  test("yields an empty ref when a side carries no ref", async () => {
    const context = makeContext();
    const pr = makePr({ base: { repo: { owner: { login: "acme" } } }, head: {} });

    const args = await collectWithCompare(context, pr);

    expect(args.base).toBe("");
    expect(args.head).toBe("");
  });

  test("returns bare refs when the resolved owner is empty", async () => {
    const context = makeContext({ owner: "", repo: "widgets" });
    const pr = makePr({ base: { ref: "main" }, head: { ref: "feature" } });

    const args = await collectWithCompare(context, pr);

    expect(args.base).toBe("main");
    expect(args.head).toBe("feature");
  });
});

describe("collectPullRequestData config handling", () => {
  function perPageOf(octokit) {
    return octokit.paginate.mock.calls.map((call) => call[1].per_page);
  }

  test("treats a missing config as every check enabled with the default page size", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), undefined);

    expect(paginatedEndpoints(context.octokit)).toEqual([
      context.octokit.rest.pulls.listCommits,
      context.octokit.rest.pulls.listFiles,
      context.octokit.rest.pulls.listReviews,
    ]);
    expect(perPageOf(context.octokit)).toEqual([100, 100, 100]);
  });

  test("treats a config without checks as every check enabled", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), { api: { listPerPage: 25 } });

    expect(perPageOf(context.octokit)).toEqual([25, 25, 25]);
    expect(context.octokit.rest.repos.compareCommits).toHaveBeenCalledWith(
      expect.objectContaining({ per_page: 1 })
    );
  });

  test("falls back to a page size of 100 when api is absent", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), {
      checks: checksEnablingOnly("wipCommitMessages"),
    });

    expect(perPageOf(context.octokit)).toEqual([100]);
  });

  test("falls back to a page size of 100 when listPerPage is absent", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), {
      api: {},
      checks: checksEnablingOnly("wipCommitMessages"),
    });

    expect(perPageOf(context.octokit)).toEqual([100]);
  });

  test("falls back to a page size of 100 when listPerPage is not a number", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), {
      api: { listPerPage: "50" },
      checks: checksEnablingOnly("wipCommitMessages"),
    });

    expect(perPageOf(context.octokit)).toEqual([100]);
  });

  test("falls back to a page size of 100 when listPerPage is NaN", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), {
      api: { listPerPage: Number.NaN },
      checks: checksEnablingOnly("sensitiveFiles"),
    });

    expect(perPageOf(context.octokit)).toEqual([100]);
  });

  test("falls back to a page size of 100 when listPerPage is Infinity", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), {
      api: { listPerPage: Number.POSITIVE_INFINITY },
      checks: checksEnablingOnly("minApprovals"),
    });

    expect(perPageOf(context.octokit)).toEqual([100]);
  });

  test("honours a finite listPerPage on every list endpoint", async () => {
    const context = makeContext();

    await collectPullRequestData(context, makePr(), {
      api: { listPerPage: 30 },
      checks: checksEnablingOnly("wipCommitMessages", "sensitiveFiles", "minApprovals"),
    });

    expect(context.octokit.paginate).toHaveBeenCalledWith(context.octokit.rest.pulls.listCommits, {
      owner: "acme",
      repo: "widgets",
      pull_number: 42,
      per_page: 30,
    });
    expect(perPageOf(context.octokit)).toEqual([30, 30, 30]);
  });
});
