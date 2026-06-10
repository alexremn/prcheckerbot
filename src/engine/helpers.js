function isEnabled(checkConfig) {
  return !(checkConfig && checkConfig.enabled === false);
}

function asNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toLowerStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry).toLowerCase());
}

function interpolate(template, variables) {
  if (typeof template !== "string" || template.length === 0) {
    return "";
  }

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return String(variables[key]);
    }
    return match;
  });
}

function compileRegex({ checkName, pattern, flags, fallback, logger }) {
  if (!pattern) {
    return fallback || null;
  }

  try {
    return new RegExp(pattern, typeof flags === "string" ? flags : "");
  } catch (error) {
    if (logger && typeof logger.warn === "function") {
      logger.warn(`Invalid regex in checks.${checkName}: ${error.message}`);
    }
    return fallback || null;
  }
}

function getCommitSubject(message) {
  if (typeof message !== "string") {
    return "";
  }

  return message.split("\n")[0].trim();
}

// COMMENTED / PENDING reviews do not change a reviewer's standing approval
// on GitHub, so they must not overwrite an earlier APPROVED state here.
const APPROVAL_AFFECTING_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

function countCurrentApprovals(reviews) {
  const latestByReviewer = new Map();

  for (const review of reviews) {
    const login = review && review.user && review.user.login ? review.user.login.toLowerCase() : null;
    const state = review && review.state ? review.state : null;

    if (!login || !state || !APPROVAL_AFFECTING_STATES.has(state)) {
      continue;
    }

    latestByReviewer.set(login, state);
  }

  return Array.from(latestByReviewer.values()).filter((state) => state === "APPROVED").length;
}

function lowerCaseKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.toLowerCase(), entry]));
}

function stripHtmlComments(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text.replace(/<!--[\s\S]*?-->/g, "");
}

module.exports = {
  asNumber,
  compileRegex,
  countCurrentApprovals,
  getCommitSubject,
  interpolate,
  isEnabled,
  lowerCaseKeys,
  stripHtmlComments,
  toLowerStringArray,
};
