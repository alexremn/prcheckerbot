const { runAction } = require("./action/runAction");

runAction().catch((error) => {
  console.error("[fatal]", error && error.stack ? error.stack : error);
  process.exit(1);
});
