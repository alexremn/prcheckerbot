const fs = require("node:fs");
const path = require("node:path");

const { RULE_CATALOG } = require("./engine/ruleCatalog");

const CONFIG_ENV_VAR = "PR_CHECKER_CONFIG_PATH";
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "../config/default.json");

// Keys that would let a malicious/typoed config reach into Object.prototype.
const UNSAFE_MERGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Top-level config keys that are not checks but are still valid.
const KNOWN_ROOT_KEYS = new Set(["checkRun", "api", "checks"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return Array.isArray(override) ? [...override] : [...base];
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const merged = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    if (UNSAFE_MERGE_KEYS.has(key)) {
      continue;
    }

    const baseValue = base[key];

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      merged[key] = deepMerge(baseValue, overrideValue);
      continue;
    }

    if (Array.isArray(overrideValue)) {
      merged[key] = [...overrideValue];
      continue;
    }

    merged[key] = overrideValue;
  }

  return merged;
}

function parseJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read ${label} config at ${filePath}: ${error.message}`);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error("Config root must be a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse ${label} config at ${filePath}: ${error.message}`);
  }
}

function logInfo(log, message) {
  if (log && typeof log.info === "function") {
    log.info(message);
    return;
  }
  console.info(message);
}

function logWarn(log, message) {
  if (log && typeof log.warn === "function") {
    log.warn(message);
    return;
  }
  console.warn(message);
}

// Config typos are otherwise silent: an unknown check name or option key is
// simply never read, and the rule quietly runs with defaults.
function validateChecksConfig(config, log) {
  for (const key of Object.keys(config)) {
    if (!KNOWN_ROOT_KEYS.has(key)) {
      logWarn(log, `Unknown config key "${key}" — ignored (typo?)`);
    }
  }

  const checks = isPlainObject(config.checks) ? config.checks : {};

  for (const [checkName, checkConfig] of Object.entries(checks)) {
    const rule = RULE_CATALOG[checkName];
    if (!rule) {
      logWarn(log, `Unknown check "checks.${checkName}" — ignored (typo?)`);
      continue;
    }

    if (!isPlainObject(checkConfig)) {
      logWarn(log, `"checks.${checkName}" must be an object — ignored`);
      continue;
    }

    const knownKeys = new Set(rule.configKeys || []);
    for (const optionKey of Object.keys(checkConfig)) {
      if (!knownKeys.has(optionKey)) {
        logWarn(log, `Unknown option "checks.${checkName}.${optionKey}" — ignored (typo?)`);
      }
    }
  }
}

function loadConfig(log) {
  const defaultConfig = parseJsonFile(DEFAULT_CONFIG_PATH, "default");
  const customPath = process.env[CONFIG_ENV_VAR];

  if (!customPath) {
    logInfo(log, `Using default config: ${DEFAULT_CONFIG_PATH}`);
    validateChecksConfig(defaultConfig, log);
    return defaultConfig;
  }

  const resolvedCustomPath = path.resolve(process.cwd(), customPath);
  const customConfig = parseJsonFile(resolvedCustomPath, "custom");

  logInfo(log, `Using custom config: ${resolvedCustomPath}`);
  const merged = deepMerge(defaultConfig, customConfig);
  validateChecksConfig(merged, log);
  return merged;
}

module.exports = {
  CONFIG_ENV_VAR,
  DEFAULT_CONFIG_PATH,
  deepMerge,
  loadConfig,
  validateChecksConfig,
};
