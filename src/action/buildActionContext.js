function noop() {}

function createConsoleLogger() {
  function format(args) {
    return args
      .map((arg) => {
        if (arg instanceof Error) {
          return arg.stack || arg.message;
        }
        if (typeof arg === "object" && arg !== null) {
          if (arg.err instanceof Error) {
            return arg.err.stack || arg.err.message;
          }
          try {
            return JSON.stringify(arg);
          } catch (_e) {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(" ");
  }

  return {
    info: (...args) => console.log(`[info] ${format(args)}`),
    warn: (...args) => console.warn(`[warn] ${format(args)}`),
    error: (...args) => console.error(`[error] ${format(args)}`),
    debug: noop,
    trace: noop,
    fatal: (...args) => console.error(`[fatal] ${format(args)}`),
  };
}

function buildActionContext({ octokit, log, owner, repo, payload }) {
  return {
    octokit,
    log,
    payload,
    repo() {
      return { owner, repo };
    },
  };
}

module.exports = {
  buildActionContext,
  createConsoleLogger,
};
