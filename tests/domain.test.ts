import { describe, it, expect } from "vitest";
import {
  balances,
  day,
  quantity,
  projectTransitions,
  roleDefaults,
} from "../packages/shared/src";
import { validateEnvironment } from "../apps/api/src/environment";
describe("domain invariants", () => {
  it("rejects unsafe production configuration without exposing connection secrets", () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: "mongodb://localhost/pmt",
        APP_ORIGIN: "http://localhost:3001",
        SESSION_DAYS: "0",
      }),
    ).toThrow("SESSION_DAYS");
    expect(() =>
      validateEnvironment({
        DATABASE_URL: "mongodb://user:secret@db/pmt",
        APP_ORIGIN: "http://example.com",
        NODE_ENV: "production",
        IDENTITY_MAIL_KEY: "a".repeat(64),
      }),
    ).toThrow("HTTPS");
    const invalidDatabaseUrl = "postgresql://user:invalid-secret@db/pmt";
    const validateDatabaseUrl = () =>
      validateEnvironment({
        DATABASE_URL: invalidDatabaseUrl,
        APP_ORIGIN: "https://example.com",
        NODE_ENV: "production",
        IDENTITY_MAIL_KEY: "a".repeat(64),
      });
    expect(validateDatabaseUrl).toThrow(
      "Set DATABASE_URL to a MongoDB connection string",
    );
    expect(validateDatabaseUrl).not.toThrow("invalid-secret");
  });
  it("validates the hosting port and defaults the local API port", () => {
    const env = {
      DATABASE_URL: "mongodb+srv://user:secret@example.mongodb.net/pmt",
      APP_ORIGIN: "https://example.com",
      IDENTITY_MAIL_KEY: "a".repeat(64),
    };
    expect(validateEnvironment(env)).toMatchObject({ API_PORT: 4000 });
    expect(validateEnvironment({ ...env, PORT: "10000" }).PORT).toBe(10000);
    expect(() => validateEnvironment({ ...env, PORT: "65536" })).toThrow(
      "PORT",
    );
  });
  it("calculates the supplied Bagmane acceptance figures exactly", () => {
    expect(balances("2600", "500", "192")).toEqual({
      ordered: "2600",
      supplied: "500",
      installed: "192",
      pendingSupply: "2100",
      pendingInstallation: "2408",
      available: "308",
      supplyUnbilled: "500",
      installationUnbilled: "192",
    });
  });
  it("retains decimal precision", () =>
    expect(balances("0.3", "0.2", "0.1").available).toBe("0.1"));
  it("rejects invalid quantities and dates", () => {
    expect(quantity.safeParse("-1").success).toBe(false);
    expect(quantity.safeParse("0").success).toBe(false);
    expect(quantity.safeParse("1.00001").success).toBe(false);
    expect(day.safeParse("2026-02-30").success).toBe(false);
  });
  it("locks closed projects and separates accounting approval from site engineering", () => {
    expect(projectTransitions.CLOSED).toEqual([]);
    expect(roleDefaults.SITE_ENGINEER).not.toContain("invoice.approve");
    expect(roleDefaults.ACCOUNTS).toContain("invoice.approve");
  });
});
