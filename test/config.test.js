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

describe("deepMerge short-circuits", () => {
  test("returns a copy of base when base is an array and override is not", () => {
    const base = ["a", "b"];
    const override = { labels: ["c"] };

    const merged = deepMerge(base, override);

    expect(merged).toEqual(["a", "b"]);
    expect(merged).not.toBe(base);
  });

  test("returns a copy of override when override is an array", () => {
    const base = { labels: ["a"] };
    const override = ["c", "d"];

    const merged = deepMerge(base, override);

    expect(merged).toEqual(["c", "d"]);
    expect(merged).not.toBe(override);
  });

  test("returns a copy of override when both sides are arrays", () => {
    const base = ["a"];
    const override = ["c"];

    const merged = deepMerge(base, override);

    expect(merged).toEqual(["c"]);
    expect(merged).not.toBe(override);
    expect(merged).not.toBe(base);
  });

  test("returns override verbatim when either side is not a plain object", () => {
    expect(deepMerge({ a: 1 }, "scalar")).toBe("scalar");
    expect(deepMerge({ a: 1 }, 7)).toBe(7);
    expect(deepMerge({ a: 1 }, null)).toBeNull();
    expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge("scalar", { a: 1 })).toEqual({ a: 1 });
  });
});

describe("loadConfig custom file failures", () => {
  const tempDirs = [];

  const writeCustomConfig = (contents) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prchecker-cfg-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "custom.json");
    fs.writeFileSync(filePath, contents);
    return filePath;
  };

  afterEach(() => {
    delete process.env[CONFIG_ENV_VAR];
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("throws with the file path when custom config is not valid JSON", () => {
    const customPath = writeCustomConfig("{ not json at all ");
    process.env[CONFIG_ENV_VAR] = customPath;

    expect(() => loadConfig(silentLog())).toThrow(
      new RegExp(`Failed to parse custom config at ${customPath}`)
    );
  });

  test("throws when custom config root is a JSON array", () => {
    const customPath = writeCustomConfig("[1, 2]");
    process.env[CONFIG_ENV_VAR] = customPath;

    expect(() => loadConfig(silentLog())).toThrow(/Config root must be a JSON object/);
  });

  test("throws when custom config root is a JSON string", () => {
    const customPath = writeCustomConfig('"str"');
    process.env[CONFIG_ENV_VAR] = customPath;

    expect(() => loadConfig(silentLog())).toThrow(/Config root must be a JSON object/);
  });

  test("throws with the resolved path when custom config file is missing", () => {
    const customPath = path.join(os.tmpdir(), "prchecker-missing-config.json");
    process.env[CONFIG_ENV_VAR] = customPath;

    expect(() => loadConfig(silentLog())).toThrow(
      new RegExp(`Failed to read custom config at ${customPath}`)
    );
  });

  test("skips __proto__ in a custom config file without polluting Object.prototype", () => {
    const customPath = writeCustomConfig(
      '{"__proto__": {"polluted": true}, "checkRun": {"name": "Safe"}}'
    );
    process.env[CONFIG_ENV_VAR] = customPath;

    const config = loadConfig(silentLog());

    expect(config.checkRun.name).toBe("Safe");
    expect({}.polluted).toBeUndefined();
    expect(config.polluted).toBeUndefined();
  });
});

describe("logger fallbacks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env[CONFIG_ENV_VAR];
  });

  test("logs config source to console.info when no logger is provided", () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    loadConfig(undefined);

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Using default config:"));
  });

  test("logs config source to console.info when logger has no info method", () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    loadConfig({});

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Using default config:"));
  });

  test("warns via console.warn when no logger is provided", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    validateChecksConfig({ nope: {} }, undefined);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown config key "nope"'));
  });

  test("warns via console.warn when logger has no warn method", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    validateChecksConfig({ nope: {} }, {});

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown config key "nope"'));
  });
});

describe("validateChecksConfig non-object check values", () => {
  test.each([
    ["a string", "yes"],
    ["a number", 3],
    ["an array", ["enabled"]],
    ["null", null],
  ])("warns when checks.labelsRequired is %s", (_description, value) => {
    const log = silentLog();

    validateChecksConfig({ checks: { labelsRequired: value } }, log);

    expect(log.warn).toHaveBeenCalledWith('"checks.labelsRequired" must be an object — ignored');
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
