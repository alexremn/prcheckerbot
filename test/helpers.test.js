const {
  asNumber,
  compileRegex,
  countCurrentApprovals,
  getCommitSubject,
  interpolate,
  isEnabled,
  lowerCaseKeys,
  stripHtmlComments,
  toLowerStringArray,
} = require("../src/engine/helpers");

describe("isEnabled", () => {
  test("returns true when config is missing", () => {
    expect(isEnabled(undefined)).toBe(true);
  });

  test("returns true unless enabled is explicitly false", () => {
    expect(isEnabled({})).toBe(true);
    expect(isEnabled({ enabled: true })).toBe(true);
    expect(isEnabled({ enabled: false })).toBe(false);
  });
});

describe("asNumber", () => {
  test("returns value when finite number", () => {
    expect(asNumber(3, 1)).toBe(3);
    expect(asNumber(0, 1)).toBe(0);
  });

  test("returns fallback for non-numbers and non-finite values", () => {
    expect(asNumber("3", 1)).toBe(1);
    expect(asNumber(NaN, 1)).toBe(1);
    expect(asNumber(Infinity, 1)).toBe(1);
    expect(asNumber(undefined, 1)).toBe(1);
  });
});

describe("toLowerStringArray", () => {
  test("lowercases entries", () => {
    expect(toLowerStringArray(["WIP", "Do Not Merge"])).toEqual(["wip", "do not merge"]);
  });

  test("returns empty array for non-arrays", () => {
    expect(toLowerStringArray("wip")).toEqual([]);
    expect(toLowerStringArray(undefined)).toEqual([]);
  });
});

describe("interpolate", () => {
  test("replaces known placeholders", () => {
    expect(interpolate("behind {count} of {ref}", { count: 3, ref: "main" })).toBe("behind 3 of main");
  });

  test("leaves unknown placeholders untouched", () => {
    expect(interpolate("hello {name}", {})).toBe("hello {name}");
  });

  test("returns empty string for non-string templates", () => {
    expect(interpolate(undefined, {})).toBe("");
  });
});

describe("compileRegex", () => {
  test("returns fallback when no pattern given", () => {
    const fallback = /x/;
    expect(compileRegex({ checkName: "t", fallback })).toBe(fallback);
  });

  test("compiles a custom pattern with flags", () => {
    const regex = compileRegex({ checkName: "t", pattern: "^abc", flags: "i" });
    expect(regex.test("ABCdef")).toBe(true);
  });

  test("falls back and warns on invalid pattern", () => {
    const logger = { warn: jest.fn() };
    const fallback = /x/;
    const regex = compileRegex({ checkName: "t", pattern: "(", fallback, logger });
    expect(regex).toBe(fallback);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("getCommitSubject", () => {
  test("returns first line trimmed", () => {
    expect(getCommitSubject("  fix: thing  \n\nbody")).toBe("fix: thing");
  });

  test("returns empty string for non-strings", () => {
    expect(getCommitSubject(null)).toBe("");
  });
});

describe("countCurrentApprovals", () => {
  const review = (login, state) => ({ user: { login }, state });

  test("counts one approval per reviewer", () => {
    expect(countCurrentApprovals([review("a", "APPROVED"), review("b", "APPROVED")])).toBe(2);
  });

  test("keeps approval when a COMMENTED review follows it", () => {
    const reviews = [review("a", "APPROVED"), review("a", "COMMENTED")];
    expect(countCurrentApprovals(reviews)).toBe(1);
  });

  test("CHANGES_REQUESTED after approval removes it", () => {
    const reviews = [review("a", "APPROVED"), review("a", "CHANGES_REQUESTED")];
    expect(countCurrentApprovals(reviews)).toBe(0);
  });

  test("DISMISSED after approval removes it", () => {
    const reviews = [review("a", "APPROVED"), review("a", "DISMISSED")];
    expect(countCurrentApprovals(reviews)).toBe(0);
  });

  test("approval after CHANGES_REQUESTED counts", () => {
    const reviews = [review("a", "CHANGES_REQUESTED"), review("a", "APPROVED")];
    expect(countCurrentApprovals(reviews)).toBe(1);
  });

  test("ignores malformed reviews", () => {
    expect(countCurrentApprovals([{}, { user: {} }, review("a", "APPROVED")])).toBe(1);
  });
});

describe("lowerCaseKeys", () => {
  test("lowercases object keys", () => {
    expect(lowerCaseKeys({ "Do Not Merge": "msg" })).toEqual({ "do not merge": "msg" });
  });

  test("returns empty object for non-objects and arrays", () => {
    expect(lowerCaseKeys(undefined)).toEqual({});
    expect(lowerCaseKeys(["a"])).toEqual({});
  });
});

describe("stripHtmlComments", () => {
  test("removes HTML comment blocks", () => {
    expect(stripHtmlComments("<!-- template -->real text<!-- more -->")).toBe("real text");
  });

  test("handles multiline comments", () => {
    expect(stripHtmlComments("<!--\nline1\nline2\n-->after")).toBe("after");
  });

  test("returns empty string for non-strings", () => {
    expect(stripHtmlComments(null)).toBe("");
  });
});
