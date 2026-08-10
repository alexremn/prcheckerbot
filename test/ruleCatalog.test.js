const { RULE_CATALOG } = require("../src/engine/ruleCatalog");
const { buildDerivedState } = require("../src/engine/evaluatePullRequest");

const context = { log: { warn: jest.fn() } };

function makePr(overrides = {}) {
  return {
    number: 1,
    title: "feat: add feature",
    body: "A meaningful description of this change.",
    labels: [{ name: "enhancement" }],
    base: { ref: "main" },
    additions: 10,
    deletions: 5,
    ...overrides,
  };
}

function runRule(name, { check = {}, pr = makePr(), data = {} } = {}) {
  return RULE_CATALOG[name].run({
    check,
    checkName: name,
    context,
    data,
    derived: buildDerivedState(pr),
    pr,
  });
}

describe("labelsRequired", () => {
  test("fails when PR has fewer labels than minCount", () => {
    const result = runRule("labelsRequired", { check: { minCount: 2 } });
    expect(result.failures).toHaveLength(1);
  });

  test("passes when label count is sufficient", () => {
    const result = runRule("labelsRequired", { check: { minCount: 1 } });
    expect(result.failures).toHaveLength(0);
  });
});

describe("blockedLabels", () => {
  test("fails for each blocked label present", () => {
    const pr = makePr({ labels: [{ name: "WIP" }, { name: "do not merge" }] });
    const result = runRule("blockedLabels", { check: { labels: ["wip", "do not merge"] }, pr });
    expect(result.failures).toHaveLength(2);
  });

  test("uses custom message regardless of message key casing", () => {
    const pr = makePr({ labels: [{ name: "wip" }] });
    const result = runRule("blockedLabels", {
      check: { labels: ["wip"], messages: { WIP: "custom wip message" } },
      pr,
    });
    expect(result.failures).toEqual(["custom wip message"]);
  });

  test("passes when no blocked labels present", () => {
    const result = runRule("blockedLabels", { check: { labels: ["wip"] } });
    expect(result.failures).toHaveLength(0);
  });
});

describe("titlePatternBlock", () => {
  test("fails on WIP title with default pattern", () => {
    const pr = makePr({ title: "WIP: new thing" });
    expect(runRule("titlePatternBlock", { pr }).failures).toHaveLength(1);
  });

  test("passes on clean title", () => {
    expect(runRule("titlePatternBlock", {}).failures).toHaveLength(0);
  });
});

describe("descriptionRequired", () => {
  test("fails on whitespace-only body", () => {
    const pr = makePr({ body: "      " });
    expect(runRule("descriptionRequired", { check: { minLength: 5 }, pr }).failures).toHaveLength(1);
  });

  test("fails when body is only PR-template HTML comments", () => {
    const pr = makePr({ body: "<!-- Describe your changes here -->" });
    expect(runRule("descriptionRequired", { check: { minLength: 5 }, pr }).failures).toHaveLength(1);
  });

  test("passes with a real description", () => {
    expect(runRule("descriptionRequired", { check: { minLength: 5 } }).failures).toHaveLength(0);
  });
});

describe("requiredLabels", () => {
  const check = {
    groups: [{ anyOf: ["qa passed"], message: "needs QA" }],
  };

  test("fails when no label from group present", () => {
    expect(runRule("requiredLabels", { check }).failures).toEqual(["needs QA"]);
  });

  test("passes when group label present", () => {
    const pr = makePr({ labels: [{ name: "QA Passed" }] });
    expect(runRule("requiredLabels", { check, pr }).failures).toHaveLength(0);
  });
});

describe("minApprovals", () => {
  test("fails when approvals below required", () => {
    const data = { reviews: [] };
    const result = runRule("minApprovals", { check: { required: 1 }, data });
    expect(result.failures).toEqual(["❌ At least 1 approval review(s) required (currently: 0)"]);
  });

  test("passes when approvals meet requirement despite later comment", () => {
    const data = {
      reviews: [
        { user: { login: "alice" }, state: "APPROVED" },
        { user: { login: "alice" }, state: "COMMENTED" },
      ],
    };
    expect(runRule("minApprovals", { check: { required: 1 }, data }).failures).toHaveLength(0);
  });
});

describe("baseBranchAllowed", () => {
  test("fails for disallowed base branch", () => {
    const pr = makePr({ base: { ref: "develop" } });
    const result = runRule("baseBranchAllowed", { check: { allowed: ["main"] }, pr });
    expect(result.failures).toHaveLength(1);
  });

  test("passes for allowed base branch case-insensitively", () => {
    const pr = makePr({ base: { ref: "Main" } });
    expect(runRule("baseBranchAllowed", { check: { allowed: ["main"] }, pr }).failures).toHaveLength(0);
  });
});

describe("bigPrWarning", () => {
  test("warns when total changes exceed max", () => {
    const pr = makePr({ additions: 400, deletions: 200 });
    const result = runRule("bigPrWarning", { check: { maxChanges: 500 }, pr });
    expect(result.warnings).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
  });

  test("stays silent under the limit", () => {
    expect(runRule("bigPrWarning", { check: { maxChanges: 500 } }).warnings).toHaveLength(0);
  });
});

describe("commit message rules", () => {
  const commits = (...messages) => ({
    commits: messages.map((message) => ({ commit: { message } })),
  });

  test("wipCommitMessages fails on WIP commit", () => {
    const data = commits("feat: good", "wip stuff");
    expect(runRule("wipCommitMessages", { data }).failures).toHaveLength(1);
  });

  test("mergeCommits fails on merge commit", () => {
    const data = commits("Merge branch 'main' into feature");
    expect(runRule("mergeCommits", { data }).failures).toHaveLength(1);
  });

  test("fixupCommits fails on fixup commit", () => {
    const data = commits("fixup! earlier change");
    expect(runRule("fixupCommits", { data }).failures).toHaveLength(1);
  });

  test("clean commits pass all three", () => {
    const data = commits("feat: implement the new validation rule");
    expect(runRule("wipCommitMessages", { data }).failures).toHaveLength(0);
    expect(runRule("mergeCommits", { data }).failures).toHaveLength(0);
    expect(runRule("fixupCommits", { data }).failures).toHaveLength(0);
  });
});

describe("meaningfulCommitMessages", () => {
  const check = {
    minSubjectLength: 11,
    disallowedExactSubjects: ["fix", "update"],
    disallowedPrefixes: ["temp"],
  };

  test.each([
    ["too short", "short msg"],
    ["disallowed exact subject", "fix"],
    ["disallowed prefix", "temp: try something out"],
  ])("fails on %s", (_label, message) => {
    const data = { commits: [{ commit: { message } }] };
    expect(runRule("meaningfulCommitMessages", { check, data }).failures).toHaveLength(1);
  });

  test("passes meaningful subject", () => {
    const data = { commits: [{ commit: { message: "feat: add validation for labels" } }] };
    expect(runRule("meaningfulCommitMessages", { check, data }).failures).toHaveLength(0);
  });
});

describe("branchUpToDate", () => {
  test("fails when behind_by exceeds max", () => {
    const data = { compare: { behind_by: 10 } };
    const result = runRule("branchUpToDate", { check: { maxCommitsBehind: 5 }, data });
    expect(result.failures[0]).toContain("10 commits behind main");
  });

  test("passes when within limit", () => {
    const data = { compare: { behind_by: 3 } };
    expect(runRule("branchUpToDate", { check: { maxCommitsBehind: 5 }, data }).failures).toHaveLength(0);
  });

  test("treats missing compare data as up to date", () => {
    expect(runRule("branchUpToDate", { check: {}, data: { compare: {} } }).failures).toHaveLength(0);
  });
});

describe("sensitiveFiles", () => {
  const check = {
    blockedExtensions: [".pem"],
    blockedPatterns: ["(^|/)id_(rsa|dsa|ecdsa|ed25519)$", "(^|/)\\.env(?!\\.example$)(\\..+)?$"],
  };

  test("fails on blocked extension", () => {
    const data = { files: [{ filename: "certs/server.pem" }] };
    expect(runRule("sensitiveFiles", { check, data }).failures).toHaveLength(1);
  });

  test("fails on pattern match without extension", () => {
    const data = { files: [{ filename: ".ssh/id_rsa" }] };
    expect(runRule("sensitiveFiles", { check, data }).failures).toHaveLength(1);
  });

  test("blocks .env.production but allows .env.example", () => {
    expect(
      runRule("sensitiveFiles", { check, data: { files: [{ filename: ".env.production" }] } }).failures
    ).toHaveLength(1);
    expect(
      runRule("sensitiveFiles", { check, data: { files: [{ filename: ".env.example" }] } }).failures
    ).toHaveLength(0);
  });

  test("passes clean file list", () => {
    const data = { files: [{ filename: "src/index.js" }] };
    expect(runRule("sensitiveFiles", { check, data }).failures).toHaveLength(0);
  });
});

describe("requiredLabels group shapes", () => {
  test.each([
    ["an empty anyOf array", []],
    ["a missing anyOf", undefined],
    ["a non-array anyOf", "qa passed"],
  ])("skips a group with %s even when nothing matches", (_label, anyOf) => {
    const check = { groups: [{ anyOf, message: "should never surface" }] };

    expect(runRule("requiredLabels", { check }).failures).toEqual([]);
  });

  test("skippable groups do not suppress failures from valid groups", () => {
    const check = {
      groups: [{ anyOf: [] }, { anyOf: ["qa passed"], message: "needs QA" }],
    };

    expect(runRule("requiredLabels", { check }).failures).toEqual(["needs QA"]);
  });

  test("treats non-array groups as no groups", () => {
    expect(runRule("requiredLabels", { check: { groups: "qa passed" } }).failures).toEqual([]);
  });
});

describe("meaningfulCommitMessages subject edge cases", () => {
  const check = {
    minSubjectLength: 11,
    disallowedExactSubjects: ["fix", "update"],
    disallowedPrefixes: ["temp"],
  };

  test.each([
    ["an empty message", { commit: { message: "" } }],
    ["a newline-only message", { commit: { message: "\n\n" } }],
    ["a whitespace-only message", { commit: { message: "   \t  " } }],
    ["a commit without a commit object", { sha: "abc123" }],
    ["a null commit entry", null],
  ])("does not flag %s", (_label, commit) => {
    const data = { commits: [commit] };

    expect(runRule("meaningfulCommitMessages", { check, data }).failures).toHaveLength(0);
  });
});

describe("meaningfulCommitMessages long subjects", () => {
  const check = {
    minSubjectLength: 3,
    disallowedExactSubjects: ["Update Dependencies"],
    disallowedPrefixes: ["temp"],
  };

  test("flags a long-enough subject that exactly matches a disallowed subject case-insensitively", () => {
    const data = { commits: [{ commit: { message: "UPDATE DEPENDENCIES\n\ndetails here" } }] };

    expect(runRule("meaningfulCommitMessages", { check, data }).failures).toHaveLength(1);
  });

  test("flags a long-enough subject that starts with a disallowed prefix case-insensitively", () => {
    const data = { commits: [{ commit: { message: "TEMP: debugging the flaky test" } }] };

    expect(runRule("meaningfulCommitMessages", { check, data }).failures).toHaveLength(1);
  });

  test("passes a long-enough subject matching neither exact subjects nor prefixes", () => {
    const data = { commits: [{ commit: { message: "refactor: extract the rule catalog" } }] };

    expect(runRule("meaningfulCommitMessages", { check, data }).failures).toHaveLength(0);
  });
});

describe("commit pattern rules with malformed commit entries", () => {
  const patternRules = ["wipCommitMessages", "mergeCommits", "fixupCommits"];

  test.each(patternRules)("%s treats a commit without a .commit object as empty", (name) => {
    const data = { commits: [{ sha: "abc" }, null, undefined] };

    expect(runRule(name, { data }).failures).toEqual([]);
  });

  test.each(patternRules)("%s still flags a real match alongside malformed entries", (name) => {
    const message = { wipCommitMessages: "WIP: later", mergeCommits: "Merge branch 'x'", fixupCommits: "fixup! earlier" }[name];
    const data = { commits: [null, { sha: "abc" }, { commit: { message } }] };

    expect(runRule(name, { data }).failures).toHaveLength(1);
  });
});

describe("requiredLabels default message", () => {
  test("falls back to listing the required labels when the group has no message", () => {
    const check = { groups: [{ anyOf: ["Bug", "Feature"] }] };

    const result = runRule("requiredLabels", { check, pr: makePr({ labels: [] }) });

    expect(result.failures).toEqual(["❌ Missing one of required labels: bug, feature"]);
  });
});

describe("bigPrWarning missing change counts", () => {
  test("renders 0 for additions and deletions the payload omits", () => {
    // derived.totalChanges is computed from the same missing fields, so drive
    // the warning with maxChanges: -1 to reach the interpolation branch.
    const pr = makePr({ additions: undefined, deletions: undefined });

    const result = runRule("bigPrWarning", { check: { maxChanges: -1 }, pr });

    expect(result.warnings).toEqual([
      "⚠️ Big PR: 0 additions + 0 deletions = 0 total changes",
    ]);
  });
});

describe("sensitiveInfoInBody", () => {
  test("fails on secret in body", () => {
    const pr = makePr({ body: "password: hunter2hunter2" });
    expect(runRule("sensitiveInfoInBody", { pr }).failures).toHaveLength(1);
  });

  test("fails on secret in title", () => {
    const pr = makePr({ title: "fix login api_key=abcdef1234567890" });
    expect(runRule("sensitiveInfoInBody", { pr }).failures).toHaveLength(1);
  });

  test("passes clean body and title", () => {
    expect(runRule("sensitiveInfoInBody", {}).failures).toHaveLength(0);
  });
});
