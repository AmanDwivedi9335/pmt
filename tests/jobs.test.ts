import { beforeAll, afterAll, it, expect } from "vitest";
import { Db } from "../apps/api/src/db";
import { runJob } from "../apps/api/src/jobs";
import { randomUUID } from "node:crypto";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://pmt@127.0.0.1:5435/pmt_test";
const db = new Db();
beforeAll(() => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
});
afterAll(() => db.$disconnect());
it("uses SKIP LOCKED so concurrent workers deliver a job once", async () => {
  const job = await db.outbox.create({
    data: {
      kind: "EMAIL",
      dedupeKey: randomUUID(),
      payload: { to: "sink@example.test", subject: "Test", text: "Test" },
    },
  });
  let delivered = 0;
  const deliver = async () => {
    delivered++;
    await new Promise((r) => setTimeout(r, 30));
  };
  const results = await Promise.all([
    runJob(db, deliver, job.id),
    runJob(db, deliver, job.id),
  ]);
  expect(results.sort()).toEqual([false, true]);
  expect(delivered).toBe(1);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: job.id } })).processedAt,
  ).not.toBeNull();
});
it("records failed delivery, backs off, retries, and retains deduplication identity", async () => {
  const key = randomUUID(),
    job = await db.outbox.create({
      data: {
        kind: "EMAIL",
        dedupeKey: key,
        payload: { to: "sink@example.test", subject: "Test", text: "Test" },
      },
    });
  await runJob(
    db,
    async () => {
      throw new Error("SMTP unavailable");
    },
    job.id,
  );
  let stored = await db.outbox.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.attempts).toBe(1);
  expect(stored.processedAt).toBeNull();
  expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now());
  await db.outbox.update({
    where: { id: job.id },
    data: { availableAt: new Date(0) },
  });
  await runJob(db, async () => {}, job.id);
  stored = await db.outbox.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.attempts).toBe(2);
  expect(stored.processedAt).not.toBeNull();
  expect(stored.dedupeKey).toBe(key);
});
it("fails closed when document scanning is not configured", async () => {
  const previous = process.env.MALWARE_SCAN_URL;
  delete process.env.MALWARE_SCAN_URL;
  try {
    const job = await db.outbox.create({
      data: {
        kind: "SCAN",
        dedupeKey: randomUUID(),
        payload: { documentId: randomUUID() },
      },
    });
    await runJob(db, async () => {}, job.id);
    const stored = await db.outbox.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.processedAt).toBeNull();
    expect(stored.attempts).toBe(1);
  } finally {
    if (previous) process.env.MALWARE_SCAN_URL = previous;
  }
});
