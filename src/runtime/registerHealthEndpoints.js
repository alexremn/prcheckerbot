function registerHealthEndpoints(addHandler, log, state = { isReady: true }) {
  if (typeof addHandler !== "function") {
    if (log && typeof log.warn === "function") {
      log.warn("addHandler unavailable; skipping health endpoints");
    }
    return;
  }

  addHandler((req, res) => {
    if (req.method !== "GET") return false;
    const path = (req.url || "").split("?")[0];

    if (path === "/healthz") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "ok" }));
      return true;
    }

    if (path === "/readyz") {
      const isReady = Boolean(state.isReady);
      res
        .writeHead(isReady ? 200 : 503, { "content-type": "application/json" })
        .end(JSON.stringify({ status: isReady ? "ready" : "starting" }));
      return true;
    }

    return false;
  });
}

module.exports = {
  registerHealthEndpoints,
};
