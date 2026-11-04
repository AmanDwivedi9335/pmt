import { describe, it, expect } from "vitest";
import { resolveWebSettings } from "../scripts/web-settings.cjs";
describe("local portal startup", () => {
  it("aligns the web listener with APP_ORIGIN and loads the API port from root configuration", () => {
    const result = resolveWebSettings(
      {
        APP_ORIGIN: "http://localhost:3001",
        WEB_PORT: "3001",
        API_PORT: "4100",
      },
      {},
      "dev",
    );
    expect(result.port).toBe("3001");
    expect(result.env.API_PORT).toBe("4100");
  });
  it("rejects a port/origin mismatch instead of silently starting on another port", () => {
    expect(() =>
      resolveWebSettings(
        { APP_ORIGIN: "http://localhost:3000", WEB_PORT: "3001" },
        {},
        "dev",
      ),
    ).toThrow("match");
  });
  it("keeps seed credentials out of the web child environment", () => {
    const result = resolveWebSettings(
      { SEED_EMAIL: "secret@example.test", SEED_PASSWORD: "secret" },
      { SEED_EMAIL: "inherited@example.test", SEED_PASSWORD: "inherited" },
      "build",
    );
    expect(result.env.SEED_EMAIL).toBeUndefined();
    expect(result.env.SEED_PASSWORD).toBeUndefined();
  });
  it("allows a production HTTPS public origin with a separate internal listener", () => {
    expect(
      resolveWebSettings(
        { APP_ORIGIN: "https://operations.example.com", WEB_PORT: "3000" },
        {},
        "start",
      ).port,
    ).toBe("3000");
  });
});
