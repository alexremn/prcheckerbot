const HEALTH_RESPONSES = {
  "/healthz": { status: "ok" },
  "/readyz": { status: "ready" },
};

function registerHealthEndpoints(addHandler, log) {
  if (typeof addHandler !== "function") {
    if (log && typeof log.warn === "function") {
      log.warn("addHandler unavailable; skipping health endpoints");
    }
    return;
  }

  addHandler((req, res) => {
    if (req.method !== "GET") return false;
    const path = (req.url || "").split("?")[0];
    const body = HEALTH_RESPONSES[path];
    if (!body) return false;
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(body));
    return true;
  });
}

module.exports = {
  registerHealthEndpoints,
};
