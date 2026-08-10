const { buildDerivedState, evaluatePullRequest } = require("../src/engine/evaluatePullRequest");
const { RULE_CATALOG } = require("../src/engine/ruleCatalog");

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

function checksEnablingOnly(...enabledCheckNames) {
  const checks = {};

  for (const checkName of Object.keys(RULE_CATALOG)) {
    checks[checkName] = { enabled: enabledCheckNames.includes(checkName) };
  }

  return { checks };
}

describe("evaluatePullRequest config fallback", () => {
  test("treats a missing config as every check enabled", async () => {
    const context = makeContext();

    const { failures } = await evaluatePullRequest(context, makePr({ labels: [] }), undefined);

    expect(failures).toContain("❌ Please add labels to this PR");
  });

  test("treats a config without checks as every check enabled", async () => {
    const context = makeContext();

    const { failures } = await evaluatePullRequest(context, makePr({ labels: [] }), {});

    expect(failures).toContain("❌ Please add labels to this PR");
  });
});

describe("evaluatePullRequest warnings", () => {
  test("accumulates warnings from a warning-only rule", async () => {
    const context = makeContext();
    const pr = makePr({ additions: 400, deletions: 401 });
    const config = checksEnablingOnly("bigPrWarning");

    const { failures, warnings } = await evaluatePullRequest(context, pr, config);

    expect(failures).toHaveLength(0);
    expect(warnings).toEqual([
      "⚠️ Big PR: 400 additions + 401 deletions = 801 total changes",
    ]);
  });

  test("collects failures and warnings side by side when both kinds of rule fire", async () => {
    const context = makeContext();
    const pr = makePr({ labels: [], additions: 600, deletions: 0 });
    const config = checksEnablingOnly("labelsRequired", "bigPrWarning");

    const { failures, warnings } = await evaluatePullRequest(context, pr, config);

    expect(failures).toEqual(["❌ Please add labels to this PR"]);
    expect(warnings).toEqual([
      "⚠️ Big PR: 600 additions + 0 deletions = 600 total changes",
    ]);
  });
});

// The outcome-shape guards in evaluatePullRequest cannot be reached through any
// catalog rule (they all return well-formed { failures, warnings } objects), so
// a throwaway rule is registered for the duration of a single evaluation.
const TEMPORARY_RULE_NAME = "__temporaryRuleUnderTest";

async function evaluateWithTemporaryRule(run) {
  const config = checksEnablingOnly();
  RULE_CATALOG[TEMPORARY_RULE_NAME] = { requiredData: [], configKeys: ["enabled"], run };

  try {
    return await evaluatePullRequest(makeContext(), makePr(), config);
  } finally {
    delete RULE_CATALOG[TEMPORARY_RULE_NAME];
  }
}

describe("evaluatePullRequest outcome guards", () => {
  test("ignores a rule that returns undefined", async () => {
    const result = await evaluateWithTemporaryRule(() => undefined);

    expect(result).toEqual({ failures: [], warnings: [] });
  });

  test("ignores a rule that returns null", async () => {
    const result = await evaluateWithTemporaryRule(() => null);

    expect(result).toEqual({ failures: [], warnings: [] });
  });

  test("ignores a rule outcome that carries neither failures nor warnings", async () => {
    const result = await evaluateWithTemporaryRule(() => ({}));

    expect(result).toEqual({ failures: [], warnings: [] });
  });

  test("ignores a rule outcome whose failures and warnings are not arrays", async () => {
    const result = await evaluateWithTemporaryRule(() => ({ failures: "boom", warnings: 7 }));

    expect(result).toEqual({ failures: [], warnings: [] });
  });

  test("ignores a rule outcome with empty failure and warning arrays", async () => {
    const result = await evaluateWithTemporaryRule(() => ({ failures: [], warnings: [] }));

    expect(result).toEqual({ failures: [], warnings: [] });
  });

  test("restores the catalog after a temporary rule is used", async () => {
    await evaluateWithTemporaryRule(() => ({ failures: ["❌ temp"], warnings: [] }));

    expect(Object.keys(RULE_CATALOG)).not.toContain(TEMPORARY_RULE_NAME);
  });
});

describe("buildDerivedState", () => {
  test("returns empty defaults for a PR with no fields set", () => {
    const derived = buildDerivedState({});

    expect(derived.labels).toEqual([]);
    expect(derived.labelSet.size).toBe(0);
    expect(derived.title).toBe("");
    expect(derived.body).toBe("");
    expect(derived.baseRef).toBe("");
    expect(derived.totalChanges).toBe(0);
  });

  test("returns no labels for an empty labels array", () => {
    const derived = buildDerivedState({ labels: [] });

    expect(derived.labels).toEqual([]);
  });

  test("maps a label with a missing name to an empty string", () => {
    const derived = buildDerivedState({ labels: [{}, { name: null }] });

    expect(derived.labels).toEqual(["", ""]);
    expect(derived.labelSet.has("")).toBe(true);
  });

  test("stringifies a non-string label name", () => {
    const derived = buildDerivedState({ labels: [{ name: 42 }] });

    expect(derived.labels).toEqual(["42"]);
  });

  test("lower-cases label names", () => {
    const derived = buildDerivedState({ labels: [{ name: "Needs-QA" }] });

    expect(derived.labels).toEqual(["needs-qa"]);
  });

  test("lower-cases the base ref", () => {
    const derived = buildDerivedState({ base: { ref: "Main" } });

    expect(derived.baseRef).toBe("main");
  });

  test("returns an empty base ref when base carries no ref", () => {
    const derived = buildDerivedState({ base: {} });

    expect(derived.baseRef).toBe("");
  });

  test("counts additions alone when deletions are missing", () => {
    const derived = buildDerivedState({ additions: 3 });

    expect(derived.totalChanges).toBe(3);
  });

  test("counts deletions alone when additions are missing", () => {
    const derived = buildDerivedState({ deletions: 4 });

    expect(derived.totalChanges).toBe(4);
  });

  test("keeps title and body when present", () => {
    const derived = buildDerivedState({ title: "feat: x", body: "why" });

    expect(derived.title).toBe("feat: x");
    expect(derived.body).toBe("why");
  });
});
