const fs = require("node:fs");
const path = require("node:path");

const CONFIG_ENV_VAR = "PR_CHECKER_CONFIG_PATH";
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "../config/default.json");

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

function loadConfig(log) {
  const defaultConfig = parseJsonFile(DEFAULT_CONFIG_PATH, "default");
  const customPath = process.env[CONFIG_ENV_VAR];

  if (!customPath) {
    logInfo(log, `Using default config: ${DEFAULT_CONFIG_PATH}`);
    return defaultConfig;
  }

  const resolvedCustomPath = path.resolve(process.cwd(), customPath);
  const customConfig = parseJsonFile(resolvedCustomPath, "custom");

  logInfo(log, `Using custom config: ${resolvedCustomPath}`);
  return deepMerge(defaultConfig, customConfig);
}

module.exports = {
  CONFIG_ENV_VAR,
  DEFAULT_CONFIG_PATH,
  loadConfig,
};
