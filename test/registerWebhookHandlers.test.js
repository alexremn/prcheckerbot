jest.mock("../src/github/loadPullRequest", () => ({ loadPullRequest: jest.fn() }));
jest.mock("../src/workflow/runPrValidation", () => ({ runPrValidation: jest.fn() }));

const { loadPullRequest } = require("../src/github/loadPullRequest");
const { runPrValidation } = require("../src/workflow/runPrValidation");
const { registerWebhookHandlers } = require("../src/runtime/registerWebhookHandlers");

const PULL_REQUEST_EVENTS = [
  "pull_request.opened",
  "pull_request.synchronize",
  "pull_request.reopened",
  "pull_request.labeled",
  "pull_request.unlabeled",
  "pull_request.edited",
];

function makeApp() {
  const handlers = new Map();

  return {
    events: () => [...handlers.keys()],
    on(events, handler) {
      for (const event of [].concat(events)) {
        handlers.set(event, handler);
      }
    },
    handlerFor(event) {
      const handler = handlers.get(event);
      if (!handler) {
        throw new Error(`no handler registered for ${event}`);
      }
      return handler;
    },
  };
}

function makeContext(payload) {
  return {
    payload,
    octokit: {},
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    repo: () => ({ owner: "acme", repo: "widgets" }),
  };
}

function makeCheckRunContext(checkRun) {
  return makeContext({ check_run: checkRun });
}

beforeEach(() => {
  jest.clearAllMocks();
  loadPullRequest.mockImplementation(async (context, number) => ({
    number,
    title: `fetched #${number}`,
  }));
  runPrValidation.mockResolvedValue(undefined);
});

describe("registerWebhookHandlers subscriptions", () => {
  test("subscribes to every pull_request, pull_request_review and check_run event it handles", () => {
    const app = makeApp();

    registerWebhookHandlers(app, {});

    expect(app.events()).toEqual([
      ...PULL_REQUEST_EVENTS,
      "pull_request_review.submitted",
      "pull_request_review.dismissed",
      "check_run.rerequested",
    ]);
  });
});

describe("pull_request events", () => {
  test("validates the pull request straight from the payload for each subscribed event", async () => {
    const app = makeApp();
    const config = { checkRun: { name: "PR Checker" } };
    registerWebhookHandlers(app, config);

    for (const event of PULL_REQUEST_EVENTS) {
      const pr = { number: 42, title: event };
      await app.handlerFor(event)(makeContext({ pull_request: pr }));

      expect(runPrValidation).toHaveBeenLastCalledWith(expect.anything(), pr, config);
    }

    expect(runPrValidation).toHaveBeenCalledTimes(PULL_REQUEST_EVENTS.length);
  });

  test("does not refetch the pull request for pull_request events", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});

    await app.handlerFor("pull_request.opened")(makeContext({ pull_request: { number: 1 } }));

    expect(loadPullRequest).not.toHaveBeenCalled();
  });

  test("passes the same context object it received to runPrValidation", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});
    const context = makeContext({ pull_request: { number: 3 } });

    await app.handlerFor("pull_request.synchronize")(context);

    expect(runPrValidation).toHaveBeenCalledWith(context, { number: 3 }, {});
  });

  test("forwards an absent pull_request payload as undefined", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});

    await app.handlerFor("pull_request.edited")(makeContext({}));

    expect(runPrValidation).toHaveBeenCalledWith(expect.anything(), undefined, {});
  });

  test("rejects when runPrValidation rejects", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});
    runPrValidation.mockRejectedValue(new Error("evaluation blew up"));

    await expect(
      app.handlerFor("pull_request.opened")(makeContext({ pull_request: { number: 9 } }))
    ).rejects.toThrow("evaluation blew up");
  });
});

describe("pull_request_review events", () => {
  test("refetches the pull request before validating a submitted review", async () => {
    const app = makeApp();
    const config = {};
    registerWebhookHandlers(app, config);

    await app.handlerFor("pull_request_review.submitted")(
      makeContext({ pull_request: { number: 12 } })
    );

    expect(loadPullRequest).toHaveBeenCalledWith(expect.anything(), 12);
    expect(runPrValidation).toHaveBeenCalledWith(
      expect.anything(),
      { number: 12, title: "fetched #12" },
      config
    );
  });

  test("refetches the pull request before validating a dismissed review", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});

    await app.handlerFor("pull_request_review.dismissed")(
      makeContext({ pull_request: { number: 13 } })
    );

    expect(loadPullRequest).toHaveBeenCalledWith(expect.anything(), 13);
    expect(runPrValidation).toHaveBeenCalledWith(
      expect.anything(),
      { number: 13, title: "fetched #13" },
      {}
    );
  });

  test("rejects without validating when the refetch fails", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});
    loadPullRequest.mockRejectedValue(new Error("404 not found"));

    await expect(
      app.handlerFor("pull_request_review.submitted")(makeContext({ pull_request: { number: 5 } }))
    ).rejects.toThrow("404 not found");
    expect(runPrValidation).not.toHaveBeenCalled();
  });
});

describe("check_run.rerequested", () => {
  test("revalidates the pull request attached to our check run", async () => {
    const app = makeApp();
    const config = {};
    registerWebhookHandlers(app, config);

    await app.handlerFor("check_run.rerequested")(
      makeCheckRunContext({ name: "PR Checker", pull_requests: [{ number: 21 }] })
    );

    expect(loadPullRequest).toHaveBeenCalledWith(expect.anything(), 21);
    expect(runPrValidation).toHaveBeenCalledWith(
      expect.anything(),
      { number: 21, title: "fetched #21" },
      config
    );
  });

  test("revalidates every pull request attached to the same check run", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});

    await app.handlerFor("check_run.rerequested")(
      makeCheckRunContext({
        name: "PR Checker",
        pull_requests: [{ number: 1 }, { number: 2 }, { number: 3 }],
      })
    );

    expect(runPrValidation).toHaveBeenCalledTimes(3);
    expect(loadPullRequest.mock.calls.map(([, number]) => number)).toEqual([1, 2, 3]);
    expect(runPrValidation.mock.calls.map(([, pr]) => pr.number)).toEqual([1, 2, 3]);
  });

  test("ignores a check run rerun that belongs to another app", async () => {
    const app = makeApp();
    const context = makeCheckRunContext({
      name: "Someone Else CI",
      pull_requests: [{ number: 4 }],
    });
    registerWebhookHandlers(app, {});

    await app.handlerFor("check_run.rerequested")(context);

    expect(loadPullRequest).not.toHaveBeenCalled();
    expect(runPrValidation).not.toHaveBeenCalled();
    expect(context.log.warn).not.toHaveBeenCalled();
  });

  test("warns and skips validation when the check run has no pull requests", async () => {
    const app = makeApp();
    const context = makeCheckRunContext({ name: "PR Checker", pull_requests: [] });
    registerWebhookHandlers(app, {});

    await app.handlerFor("check_run.rerequested")(context);

    expect(context.log.warn).toHaveBeenCalledWith("No PR associated with this check run");
    expect(runPrValidation).not.toHaveBeenCalled();
  });

  test("warns and skips validation when pull_requests is missing", async () => {
    const app = makeApp();
    const context = makeCheckRunContext({ name: "PR Checker" });
    registerWebhookHandlers(app, {});

    await app.handlerFor("check_run.rerequested")(context);

    expect(context.log.warn).toHaveBeenCalledWith("No PR associated with this check run");
    expect(loadPullRequest).not.toHaveBeenCalled();
  });

  test("warns and skips validation when pull_requests is not an array", async () => {
    const app = makeApp();
    const context = makeCheckRunContext({ name: "PR Checker", pull_requests: null });
    registerWebhookHandlers(app, {});

    await app.handlerFor("check_run.rerequested")(context);

    expect(context.log.warn).toHaveBeenCalledWith("No PR associated with this check run");
    expect(loadPullRequest).not.toHaveBeenCalled();
  });

  test("matches the check run name configured in checkRun.name", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, { checkRun: { name: "Custom Gate" } });

    await app.handlerFor("check_run.rerequested")(
      makeCheckRunContext({ name: "Custom Gate", pull_requests: [{ number: 31 }] })
    );

    expect(runPrValidation).toHaveBeenCalledTimes(1);
    expect(loadPullRequest).toHaveBeenCalledWith(expect.anything(), 31);
  });

  test("ignores the default check run name once a custom name is configured", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, { checkRun: { name: "Custom Gate" } });

    await app.handlerFor("check_run.rerequested")(
      makeCheckRunContext({ name: "PR Checker", pull_requests: [{ number: 31 }] })
    );

    expect(runPrValidation).not.toHaveBeenCalled();
  });

  test("falls back to the default check run name when config is undefined", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, undefined);

    await app.handlerFor("check_run.rerequested")(
      makeCheckRunContext({ name: "PR Checker", pull_requests: [{ number: 41 }] })
    );

    expect(runPrValidation).toHaveBeenCalledWith(
      expect.anything(),
      { number: 41, title: "fetched #41" },
      undefined
    );
  });

  test("stops revalidating and rejects when one pull request fails to load", async () => {
    const app = makeApp();
    registerWebhookHandlers(app, {});
    loadPullRequest
      .mockImplementationOnce(async (context, number) => ({ number }))
      .mockRejectedValueOnce(new Error("rate limited"));

    await expect(
      app.handlerFor("check_run.rerequested")(
        makeCheckRunContext({
          name: "PR Checker",
          pull_requests: [{ number: 51 }, { number: 52 }, { number: 53 }],
        })
      )
    ).rejects.toThrow("rate limited");
    expect(runPrValidation).toHaveBeenCalledTimes(1);
  });
});
