function registerHealthEndpoints(getRouter, log) {
  if (typeof getRouter !== "function") {
    if (log && typeof log.warn === "function") {
      log.warn("getRouter unavailable; skipping health endpoints");
    }
    return;
  }

  const router = getRouter("/");

  router.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/readyz", (_req, res) => {
    res.status(200).json({ status: "ready" });
  });
}

module.exports = {
  registerHealthEndpoints,
};
