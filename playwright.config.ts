import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";
const localSettings = existsSync(".env") ? parse(readFileSync(".env")) : {};
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 90000,
  use: {
    actionTimeout: 15000,
    baseURL:
      process.env.E2E_URL ||
      process.env.APP_ORIGIN ||
      localSettings.APP_ORIGIN ||
      "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    channel: "msedge",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
