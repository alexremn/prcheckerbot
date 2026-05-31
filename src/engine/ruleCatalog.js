const {
  asNumber,
  compileRegex,
  countCurrentApprovals,
  getCommitSubject,
  interpolate,
  toLowerStringArray,
} = require("./helpers");

const EMPTY_RESULT = { failures: [], warnings: [] };

function withFailure(message) {
  return { failures: [message], warnings: [] };
}

function withWarning(message) {
  return { failures: [], warnings: [message] };
}

const RULE_CATALOG = {
  labelsRequired: {
    requiredData: [],
    run({ check, derived }) {
      const minCount = asNumber(check.minCount, 1);
      if (derived.labels.length < minCount) {
        return withFailure(check.message || "❌ Please add labels to this PR");
      }
      return EMPTY_RESULT;
    },
  },

  blockedLabels: {
    requiredData: [],
    run({ check, derived }) {
      const labels = toLowerStringArray(check.labels);
      const messages = check.messages || {};
      const fallback = check.fallbackMessage || "❌ PR has blocked label: {label}";

      const failures = labels
        .filter((blockedLabel) => derived.labelSet.has(blockedLabel))
        .map((blockedLabel) => messages[blockedLabel] || interpolate(fallback, { label: blockedLabel }));

      return { failures, warnings: [] };
    },
  },

  titlePatternBlock: {
    requiredData: [],
    run({ check, derived, context }) {
      const regex = compileRegex({
        checkName: "titlePatternBlock",
        pattern: check.pattern,
        flags: check.flags,
        fallback: /\b(wip|work.in.progress|draft)\b/i,
        logger: context.log,
      });

      if (regex && regex.test(derived.title)) {
        return withFailure(check.message || "❌ PR title contains WIP/Draft indicator");
      }

      return EMPTY_RESULT;
    },
  },

  descriptionRequired: {
    requiredData: [],
    run({ check, derived }) {
      const minLength = asNumber(check.minLength, 5);
      if (derived.body.length < minLength) {
        return withFailure(
          check.message || "❌ Please provide a meaningful summary in the Pull Request description"
        );
      }
      return EMPTY_RESULT;
    },
  },

  blockedReviewLabels: {
    requiredData: [],
    run({ check, derived }) {
      const labels = toLowerStringArray(check.labels);
      const messages = check.messages || {};
      const fallback = check.fallbackMessage || "❌ PR has blocking review label: {label}";

      const failures = labels
        .filter((blockedLabel) => derived.labelSet.has(blockedLabel))
        .map((blockedLabel) => messages[blockedLabel] || interpolate(fallback, { label: blockedLabel }));

      return { failures, warnings: [] };
    },
  },

  requiredLabels: {
    requiredData: [],
    run({ check, derived }) {
      const groups = Array.isArray(check.groups) ? check.groups : [];
      const failures = [];

      for (const group of groups) {
        const anyOf = toLowerStringArray(group.anyOf);
        if (anyOf.length === 0) {
          continue;
        }

        const matched = anyOf.some((label) => derived.labelSet.has(label));
        if (!matched) {
          failures.push(group.message || `❌ Missing one of required labels: ${anyOf.join(", ")}`);
        }
      }

      return { failures, warnings: [] };
    },
  },

  minApprovals: {
    requiredData: ["reviews"],
    run({ check, data }) {
      const required = asNumber(check.required, 1);
      const current = countCurrentApprovals(data.reviews);

      if (current < required) {
        const template =
          check.message || "❌ At least {required} approval review(s) required (currently: {current})";
        return withFailure(interpolate(template, { required, current }));
      }

      return EMPTY_RESULT;
    },
  },

  baseBranchAllowed: {
    requiredData: [],
    run({ check, derived, pr }) {
      const allowed = toLowerStringArray(check.allowed);
      if (allowed.length === 0) {
        return EMPTY_RESULT;
      }

      if (!allowed.includes(derived.baseRef)) {
        const template =
          check.message ||
          "❌ PR base branch is not allowed (currently: {baseRef}). Allowed: {allowed}";
        return withFailure(
          interpolate(template, {
            baseRef: pr.base.ref,
            allowed: allowed.join(", "),
          })
        );
      }

      return EMPTY_RESULT;
    },
  },

  bigPrWarning: {
    requiredData: [],
    run({ check, derived, pr }) {
      const maxChanges = asNumber(check.maxChanges, 500);
      if (derived.totalChanges > maxChanges) {
        const template =
          check.message ||
          "⚠️ Big PR: {additions} additions + {deletions} deletions = {totalChanges} total changes";

        return withWarning(
          interpolate(template, {
            additions: pr.additions || 0,
            deletions: pr.deletions || 0,
            totalChanges: derived.totalChanges,
          })
        );
      }

      return EMPTY_RESULT;
    },
  },

  wipCommitMessages: {
    requiredData: ["commits"],
    run({ check, data, context }) {
      const regex = compileRegex({
        checkName: "wipCommitMessages",
        pattern: check.pattern,
        flags: check.flags,
        fallback: /\b(wip|work.in.progress)\b/i,
        logger: context.log,
      });

      const hasWipCommit = data.commits.some((commit) => {
        const message = commit && commit.commit ? commit.commit.message : "";
        return Boolean(regex && message && regex.test(message));
      });

      if (hasWipCommit) {
        return withFailure(check.message || "❌ PR is a Work in Progress (commit message contains 'WIP')");
      }

      return EMPTY_RESULT;
    },
  },

  mergeCommits: {
    requiredData: ["commits"],
    run({ check, data, context }) {
      const regex = compileRegex({
        checkName: "mergeCommits",
        pattern: check.pattern,
        flags: check.flags,
        fallback: /^merge (branch|pull request)/i,
        logger: context.log,
      });

      const hasMergeCommit = data.commits.some((commit) => {
        const message = commit && commit.commit ? commit.commit.message : "";
        return Boolean(regex && message && regex.test(message));
      });

      if (hasMergeCommit) {
        return withFailure(check.message || "❌ Please rebase to remove merge commits in this PR");
      }

      return EMPTY_RESULT;
    },
  },

  fixupCommits: {
    requiredData: ["commits"],
    run({ check, data, context }) {
      const regex = compileRegex({
        checkName: "fixupCommits",
        pattern: check.pattern,
        flags: check.flags,
        fallback: /^(fixup|squash)!/i,
        logger: context.log,
      });

      const hasFixupCommit = data.commits.some((commit) => {
        const message = commit && commit.commit ? commit.commit.message : "";
        return Boolean(regex && message && regex.test(message));
      });

      if (hasFixupCommit) {
        return withFailure(
          check.message || "❌ Contains fixup or squash commits - please squash them before merging"
        );
      }

      return EMPTY_RESULT;
    },
  },

  meaningfulCommitMessages: {
    requiredData: ["commits"],
    run({ check, data }) {
      const minSubjectLength = asNumber(check.minSubjectLength, 11);
      const disallowedExact = toLowerStringArray(check.disallowedExactSubjects);
      const disallowedPrefixes = toLowerStringArray(check.disallowedPrefixes);

      const hasBadCommit = data.commits.some((commit) => {
        const message = commit && commit.commit ? commit.commit.message : "";
        const subject = getCommitSubject(message);
        if (!subject) {
          return false;
        }

        const normalized = subject.toLowerCase();

        if (subject.length < minSubjectLength) {
          return true;
        }

        if (disallowedExact.includes(normalized)) {
          return true;
        }

        return disallowedPrefixes.some((prefix) => normalized.startsWith(prefix));
      });

      if (hasBadCommit) {
        return withFailure(
          check.message ||
            "❌ Contains commits with non-meaningful messages (too short, generic, or temporary)"
        );
      }

      return EMPTY_RESULT;
    },
  },

  branchUpToDate: {
    requiredData: ["compare"],
    run({ check, data, pr }) {
      const maxBehind = asNumber(check.maxCommitsBehind, 5);
      const commitsBehind = data.compare && data.compare.ahead_by ? data.compare.ahead_by : 0;

      if (commitsBehind > maxBehind) {
        const template =
          check.message ||
          "❌ Branch is {commitsBehind} commits behind {baseRef} (max allowed: {max}). Please rebase.";

        return withFailure(
          interpolate(template, {
            commitsBehind,
            baseRef: pr.base.ref,
            max: maxBehind,
          })
        );
      }

      return EMPTY_RESULT;
    },
  },

  sensitiveFiles: {
    requiredData: ["files"],
    run({ check, data }) {
      const blockedExtensions = toLowerStringArray(check.blockedExtensions);
      const blockedFile = data.files.find((file) => {
        const filename = String(file.filename || "").toLowerCase();
        return blockedExtensions.some((ext) => filename.endsWith(ext));
      });

      if (blockedFile) {
        const template = check.message || "❌ PR contains potentially sensitive file: {filename}";
        return withFailure(interpolate(template, { filename: blockedFile.filename }));
      }

      return EMPTY_RESULT;
    },
  },

  sensitiveInfoInBody: {
    requiredData: [],
    run({ check, derived, context }) {
      const regex = compileRegex({
        checkName: "sensitiveInfoInBody",
        pattern: check.pattern,
        flags: check.flags,
        fallback:
          /(password|secret|token|api_key|apikey|private_key)\s*[:=]\s*['"]?[a-zA-Z0-9+/=]{10,}/i,
        logger: context.log,
      });

      if (regex && regex.test(derived.body)) {
        return withFailure(
          check.message || "❌ PR description may contain sensitive information (passwords, secrets, tokens)"
        );
      }

      return EMPTY_RESULT;
    },
  },
};

module.exports = {
  RULE_CATALOG,
};
