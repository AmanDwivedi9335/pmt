const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const dotenv = require("dotenv");
const { resolveWebSettings } = require("./web-settings.cjs");
const root = path.resolve(__dirname, "..");
const mode = process.argv[2];
if (!["dev", "build", "start"].includes(mode))
  throw new Error("Expected dev, build or start");
const envPath = path.join(root, ".env");
const settings = fs.existsSync(envPath)
  ? dotenv.parse(fs.readFileSync(envPath))
  : {};
// Only pass settings the web process needs. Seed credentials stay out of web configuration.
const { env, port } = resolveWebSettings(settings, process.env, mode);
const requireWeb = createRequire(path.join(root, "apps/web/package.json"));
const args = [requireWeb.resolve("next/dist/bin/next"), mode];
if (mode !== "start") args.push("--webpack");
if (mode !== "build") {
  args.push("--hostname", "0.0.0.0", "--port", port);
}
const child = spawn(process.execPath, args, {
  cwd: path.join(root, "apps/web"),
  env,
  stdio: "inherit",
});
child.on("error", () => {
  console.error("Unable to start Next.js");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
