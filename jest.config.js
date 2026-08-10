module.exports = {
  testEnvironment: "node",
  // Without this, coverage only reports files a test happened to require —
  // a module with zero tests silently vanishes from the report instead of
  // showing up as 0%.
  collectCoverageFrom: ["src/**/*.js"],
  // The suite sits at 100% on all four. Statements/functions/lines are pinned
  // there so an untested new module fails CI; branches keep a small margin so a
  // defensive `|| {}` does not block a PR and train people into lowering these.
  coverageThreshold: {
    global: {
      statements: 100,
      branches: 95,
      functions: 100,
      lines: 100,
    },
  },
};
