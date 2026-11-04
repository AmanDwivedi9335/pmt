const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { scrypt: derive, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");
const root = path.resolve(__dirname, "..");
const settings = fs.existsSync(path.join(root, ".env"))
  ? dotenv.parse(fs.readFileSync(path.join(root, ".env")))
  : {};
const env = { ...settings, ...process.env };
const requireApi = createRequire(path.join(root, "apps/api/package.json"));
const checks = [];
const record = (component, status, detail) =>
  checks.push({ component, status, detail });
const scrypt = promisify(derive);
async function endpoint(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("non-json");
  await response.json();
  if (!response.ok) throw new Error("http-failure");
}
async function main() {
  const origin = env.APP_ORIGIN || "http://localhost:3000";
  const internal =
    env.API_INTERNAL_URL || `http://127.0.0.1:${env.API_PORT || 4000}`;
  const db = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
  try {
    await db.$queryRaw`SELECT 1`;
    const unfinished =
      await db.$queryRaw`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    record("PostgreSQL", "PASS", "Database connected");
    record(
      "Migrations",
      unfinished[0].count ? "FAIL" : "PASS",
      unfinished[0].count
        ? "Unfinished migrations found"
        : "No unfinished migrations",
    );
    if (env.SEED_EMAIL && env.SEED_PASSWORD) {
      const user = await db.user.findUnique({
        where: { email: env.SEED_EMAIL.trim().toLowerCase() },
        include: { memberships: true },
      });
      let matches = false;
      if (user) {
        const [, salt, encoded] = user.passwordHash.split(":");
        if (salt && encoded) {
          const actual = await scrypt(env.SEED_PASSWORD, salt, 64);
          const expected = Buffer.from(encoded, "hex");
          matches =
            expected.length === actual.length &&
            timingSafeEqual(actual, expected);
        }
      }
      record(
        "Saved login account",
        user && matches && user.memberships.some((m) => m.active)
          ? "PASS"
          : "FAIL",
        !user
          ? "Saved SEED_EMAIL has not been seeded into the database"
          : !matches
            ? "Saved SEED_PASSWORD differs from the database password; changing .env does not reset an account"
            : !user.memberships.some((m) => m.active)
              ? "Saved credentials match, but no active organization membership exists"
              : "Saved credentials match an active database account",
      );
    } else
      record(
        "Saved login account",
        "OPTIONAL",
        "SEED_EMAIL/SEED_PASSWORD not configured; use a registered account",
      );
  } catch {
    record(
      "PostgreSQL",
      "FAIL",
      "Database or migration history unavailable; verify DATABASE_URL and start PostgreSQL",
    );
  } finally {
    await db.$disconnect();
  }
  for (const [component, url] of [
    ["API readiness", `${internal}/api/v1/ready`],
    ["Web-to-API proxy", `${origin}/api/v1/ready`],
  ]) {
    try {
      await endpoint(url);
      record(component, "PASS", "Ready endpoint returned valid JSON");
    } catch {
      record(
        component,
        "FAIL",
        "Unavailable or invalid response; run pnpm dev and use APP_ORIGIN",
      );
    }
  }
  if (process.argv.includes("--login")) {
    if (!env.SEED_EMAIL || !env.SEED_PASSWORD)
      record(
        "HTTP login",
        "FAIL",
        "Set SEED_EMAIL and SEED_PASSWORD to the account to test",
      );
    else {
      try {
        const response = await fetch(`${origin}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({
            email: env.SEED_EMAIL.trim().toLowerCase(),
            password: env.SEED_PASSWORD,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const body = await response.json();
        if (!response.ok)
          record(
            "HTTP login",
            "FAIL",
            `Login returned HTTP ${response.status}`,
          );
        else {
          const cookie = response.headers.get("set-cookie")?.split(";")[0];
          const session = await fetch(`${origin}/api/v1/auth/me`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(5000),
          });
          const me = await session.json();
          if (
            !session.ok ||
            me.user?.email !== env.SEED_EMAIL.trim().toLowerCase() ||
            !me.memberships?.length
          )
            throw new Error("session-invalid");
          const dashboard = await fetch(`${origin}/api/v1/dashboard`, {
            headers: {
              Cookie: cookie,
              "x-organization-id": me.memberships[0].orgId,
            },
            signal: AbortSignal.timeout(10000),
          });
          record(
            "HTTP login",
            "PASS",
            "Saved credentials accepted; authenticated session persisted",
          );
          record(
            "Authenticated dashboard",
            dashboard.ok ? "PASS" : "FAIL",
            `HTTP ${dashboard.status}`,
          );
          await fetch(`${origin}/api/v1/auth/logout`, {
            method: "POST",
            headers: {
              Cookie: cookie,
              Origin: origin,
              "x-csrf-token": body.csrf,
            },
            signal: AbortSignal.timeout(5000),
          });
        }
      } catch {
        record(
          "HTTP login",
          "FAIL",
          "Login/session request failed; check API readiness and APP_ORIGIN",
        );
      }
    }
  }
  if (env.SMTP_HOST && env.SMTP_FROM) {
    try {
      const nodemailer = requireApi("nodemailer");
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 1025),
        secure: env.SMTP_SECURE === "true",
        connectionTimeout: 3000,
        greetingTimeout: 3000,
        socketTimeout: 3000,
        ...(env.SMTP_USER
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
          : {}),
      });
      await transport.verify();
      transport.close();
      record(
        "Email transport",
        "PASS",
        "SMTP connection verified; no message sent",
      );
    } catch {
      record(
        "Email transport",
        "NEEDS_SETUP",
        "SMTP unavailable or authentication failed; invitation/reset email delivery is unavailable",
      );
    }
  } else
    record(
      "Email transport",
      "NEEDS_SETUP",
      "Set SMTP_HOST, SMTP_PORT and SMTP_FROM",
    );
  if (
    env.S3_ENDPOINT &&
    env.S3_BUCKET &&
    env.S3_ACCESS_KEY &&
    env.S3_SECRET_KEY
  ) {
    const { S3Client, HeadBucketCommand } = requireApi("@aws-sdk/client-s3");
    const client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || "us-east-1",
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), {
        abortSignal: AbortSignal.timeout(4000),
      });
      record(
        "Private object storage",
        "PASS",
        "Configured bucket is reachable with the configured credentials",
      );
    } catch {
      record(
        "Private object storage",
        "NEEDS_SETUP",
        "S3 service/bucket unavailable or access denied; document uploads cannot complete",
      );
    } finally {
      client.destroy();
    }
  } else
    record(
      "Private object storage",
      "NEEDS_SETUP",
      "Configure S3 endpoint, private bucket, region and credentials",
    );
  record(
    "Document malware scanning",
    env.MALWARE_SCAN_URL ? "UNVERIFIED" : "NEEDS_SETUP",
    env.MALWARE_SCAN_URL
      ? "Scanner URL configured; a real scan/upload test is still required"
      : "MALWARE_SCAN_URL absent; uploads must remain quarantined",
  );
  record(
    "Telemetry",
    env.OTEL_EXPORTER_OTLP_ENDPOINT ? "UNVERIFIED" : "OPTIONAL",
    env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? "Collector configured; trace delivery has not been verified"
      : "OTLP collector not configured; core local use does not require it",
  );
  console.log(JSON.stringify({ origin, checks }, null, 2));
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
}
main().catch(() => {
  console.error("Configuration checks failed. No credentials were printed.");
  process.exitCode = 1;
});
