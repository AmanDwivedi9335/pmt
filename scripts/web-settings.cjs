function resolveWebSettings(settings, inherited, mode) {
  const env = { ...inherited };
  delete env.SEED_EMAIL;
  delete env.SEED_PASSWORD;
  for (const key of [
    "APP_ORIGIN",
    "API_INTERNAL_URL",
    "API_PORT",
    "WEB_PORT",
  ]) {
    if (env[key] === undefined && settings[key] !== undefined)
      env[key] = settings[key];
  }
  const origin = new URL(env.APP_ORIGIN || "http://localhost:3000");
  const port =
    env.PORT || env.WEB_PORT || (mode === "dev" && origin.port) || "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("WEB_PORT must be a valid TCP port");
  if (
    mode === "dev" &&
    (origin.port || (origin.protocol === "https:" ? "443" : "80")) !== port
  )
    throw new Error(
      "WEB_PORT must match the port in APP_ORIGIN for local development",
    );
  return { env, port };
}
module.exports = { resolveWebSettings };
