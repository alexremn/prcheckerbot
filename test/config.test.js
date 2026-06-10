const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CONFIG_ENV_VAR, deepMerge, loadConfig, validateChecksConfig } = require("../src/config");

const silentLog = () => ({ info: jest.fn(), warn: jest.fn() });

describe("deepMerge", () => {
  test("merges nested objects", () => {
    const base = { a: { b: 1, c: 2 } };
    const override = { a: { c: 3 } };
    expect(deepMerge(base, override)).toEqual({ a: { b: 1, c: 3 } });
  });

  test("replaces arrays instead of concatenating", () => {
    const base = { labels: ["a", "b"] };
    const override = { labels: ["c"] };
    expect(deepMerge(base, override)).toEqual({ labels: ["c"] });
  });

  test("does not mutate inputs", () => {
    const base = { a: { b: 1 } };
    const override = { a: { b: 2 } };
    deepMerge(base, override);
    expect(base).toEqual({ a: { b: 1 } });
  });

  test("ignores __proto__ and constructor keys", () => {
    const override = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "ok": 1}');
    const merged = deepMerge({}, override);
    expect(merged.ok).toBe(1);
    expect({}.polluted).toBeUndefined();
    expect(Object.keys(merged)).toEqual(["ok"]);
  });
});

describe("loadConfig", () => {
  afterEach(() => {
    delete process.env[CONFIG_ENV_VAR];
  });

  test("returns default config when no custom path set", () => {
    const config = loadConfig(silentLog());
    expect(config.checkRun.name).toBe("PR Checker");
    expect(config.checks.labelsRequired.enabled).toBe(true);
  });

  test("merges custom config over defaults", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prchecker-"));
    const customPath = path.join(dir, "custom.json");
    fs.writeFileSync(
      customPath,
      JSON.stringify({
        checkRun: { name: "Custom Checker" },
        checks: { labelsRequired: { enabled: false } },
      })
    );
    process.env[CONFIG_ENV_VAR] = customPath;

    const config = loadConfig(silentLog());

    expect(config.checkRun.name).toBe("Custom Checker");
    expect(config.checks.labelsRequired.enabled).toBe(false);
    expect(config.checks.bigPrWarning.enabled).toBe(true);
  });

  test("throws on unreadable custom config", () => {
    process.env[CONFIG_ENV_VAR] = "/nonexistent/config.json";
    expect(() => loadConfig(silentLog())).toThrow(/Failed to read custom config/);
  });

  test("default config passes validation without warnings", () => {
    const log = silentLog();
    loadConfig(log);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("validateChecksConfig", () => {
  test("warns on unknown check name", () => {
    const log = silentLog();
    validateChecksConfig({ checks: { blockedLabel: { enabled: true } } }, log);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('checks.blockedLabel'));
  });

  test("warns on unknown option key", () => {
    const log = silentLog();
    validateChecksConfig({ checks: { labelsRequired: { enabled: true, minCont: 2 } } }, log);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("labelsRequired.minCont"));
  });

  test("warns on unknown root key", () => {
    const log = silentLog();
    validateChecksConfig({ check: {} }, log);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"check"'));
  });

  test("accepts valid config silently", () => {
    const log = silentLog();
    validateChecksConfig({ checks: { labelsRequired: { enabled: true, minCount: 2 } } }, log);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
