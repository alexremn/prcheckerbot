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

function countCurrentApprovals(reviews) {
  const latestByReviewer = new Map();

  for (const review of reviews) {
    const login = review && review.user && review.user.login ? review.user.login.toLowerCase() : null;
    const state = review && review.state ? review.state : null;

    if (!login || !state) {
      continue;
    }

    latestByReviewer.set(login, state);
  }

  return Array.from(latestByReviewer.values()).filter((state) => state === "APPROVED").length;
}

module.exports = {
  asNumber,
  compileRegex,
  countCurrentApprovals,
  getCommitSubject,
  interpolate,
  isEnabled,
  toLowerStringArray,
};
