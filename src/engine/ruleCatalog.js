const {
  asNumber,
  compileRegex,
  countCurrentApprovals,
  getCommitSubject,
  interpolate,
  lowerCaseKeys,
  stripHtmlComments,
  toLowerStringArray,
} = require("./helpers");

const EMPTY_RESULT = { failures: [], warnings: [] };

function withFailure(message) {
  return { failures: [message], warnings: [] };
}

function withWarning(message) {
  return { failures: [], warnings: [message] };
}

function createBlockedLabelsRule(defaultFallbackMessage) {
  return {
    requiredData: [],
    configKeys: ["enabled", "labels", "messages", "fallbackMessage"],
    run({ check, derived }) {
      const labels = toLowerStringArray(check.labels);
      const messages = lowerCaseKeys(check.messages);
      const fallback = check.fallbackMessage || defaultFallbackMessage;

      const failures = labels
        .filter((blockedLabel) => derived.labelSet.has(blockedLabel))
        .map((blockedLabel) => messages[blockedLabel] || interpolate(fallback, { label: blockedLabel }));

      return { failures, warnings: [] };
    },
  };
}

function createCommitPatternRule({ checkName, fallbackPattern, defaultMessage }) {
  return {
    requiredData: ["commits"],
    configKeys: ["enabled", "pattern", "flags", "message"],
    run({ check, data, context }) {
      const regex = compileRegex({
        checkName,
        pattern: check.pattern,
        flags: check.flags,
        fallback: fallbackPattern,
        logger: context.log,
      });

      const hasMatch =
        Boolean(regex) &&
        data.commits.some((commit) => {
          const message = commit && commit.commit ? commit.commit.message : "";
          return Boolean(message && regex.test(message));
        });

      if (hasMatch) {
        return withFailure(check.message || defaultMessage);
      }

      return EMPTY_RESULT;
    },
  };
}

const RULE_CATALOG = {
  labelsRequired: {
    requiredData: [],
    configKeys: ["enabled", "minCount", "message"],
    run({ check, derived }) {
      const minCount = asNumber(check.minCount, 1);
      if (derived.labels.length < minCount) {
        return withFailure(check.message || "❌ Please add labels to this PR");
      }
      return EMPTY_RESULT;
    },
  },

  blockedLabels: createBlockedLabelsRule("❌ PR has blocked label: {label}"),

  titlePatternBlock: {
    requiredData: [],
    configKeys: ["enabled", "pattern", "flags", "message"],
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
    configKeys: ["enabled", "minLength", "message"],
    run({ check, derived }) {
      const minLength = asNumber(check.minLength, 5);
      // PR-template boilerplate lives in HTML comments; whitespace is not a summary.
      const meaningfulBody = stripHtmlComments(derived.body).trim();
      if (meaningfulBody.length < minLength) {
        return withFailure(
          check.message || "❌ Please provide a meaningful summary in the Pull Request description"
        );
      }
      return EMPTY_RESULT;
    },
  },

  blockedReviewLabels: createBlockedLabelsRule("❌ PR has blocking review label: {label}"),

  requiredLabels: {
    requiredData: [],
    configKeys: ["enabled", "groups"],
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
    configKeys: ["enabled", "required", "message"],
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
    configKeys: ["enabled", "allowed", "message"],
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
    configKeys: ["enabled", "maxChanges", "message"],
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

  wipCommitMessages: createCommitPatternRule({
    checkName: "wipCommitMessages",
    fallbackPattern: /\b(wip|work.in.progress)\b/i,
    defaultMessage: "❌ PR is a Work in Progress (commit message contains 'WIP')",
  }),

  mergeCommits: createCommitPatternRule({
    checkName: "mergeCommits",
    fallbackPattern: /^merge (branch|pull request)/i,
    defaultMessage: "❌ Please rebase to remove merge commits in this PR",
  }),

  fixupCommits: createCommitPatternRule({
    checkName: "fixupCommits",
    fallbackPattern: /^(fixup|squash)!/i,
    defaultMessage: "❌ Contains fixup or squash commits - please squash them before merging",
  }),

  meaningfulCommitMessages: {
    requiredData: ["commits"],
    configKeys: ["enabled", "minSubjectLength", "disallowedExactSubjects", "disallowedPrefixes", "message"],
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
    configKeys: ["enabled", "maxCommitsBehind", "message"],
    run({ check, data, pr }) {
      const maxBehind = asNumber(check.maxCommitsBehind, 5);
      const commitsBehind =
        data.compare && Number.isFinite(data.compare.behind_by) ? data.compare.behind_by : 0;

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
    configKeys: ["enabled", "blockedExtensions", "blockedPatterns", "message"],
    run({ check, data, context }) {
      const blockedExtensions = toLowerStringArray(check.blockedExtensions);
      const blockedPatterns = (Array.isArray(check.blockedPatterns) ? check.blockedPatterns : [])
        .map((pattern) =>
          compileRegex({
            checkName: "sensitiveFiles",
            pattern,
            flags: "i",
            fallback: null,
            logger: context.log,
          })
        )
        .filter(Boolean);

      const blockedFile = data.files.find((file) => {
        const filename = String(file.filename || "").toLowerCase();
        return (
          blockedExtensions.some((ext) => filename.endsWith(ext)) ||
          blockedPatterns.some((regex) => regex.test(filename))
        );
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
    configKeys: ["enabled", "pattern", "flags", "message"],
    run({ check, derived, context }) {
      const regex = compileRegex({
        checkName: "sensitiveInfoInBody",
        pattern: check.pattern,
        flags: check.flags,
        fallback:
          /(password|secret|token|api_key|apikey|private_key)\s*[:=]\s*['"]?[a-zA-Z0-9+/=]{10,}/i,
        logger: context.log,
      });

      if (regex && regex.test(`${derived.title}\n${derived.body}`)) {
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
