import { config } from "dotenv";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Db } from "./db";
import { openMailPayload } from "./mail-payload";
import { storage } from "./collaboration";
import { randomUUID } from "node:crypto";
import pino from "pino";
config({ path: resolve(process.cwd(), "../../.env") });
const db = new Db(),
  log = pino();
const mail = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_SECURE === "true",
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
  ...(process.env.SMTP_USER
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
    : {}),
});
export async function runJob(
  database: Db = db,
  deliverEmail: (payload: any) => Promise<unknown> = (payload) =>
    mail.sendMail(payload),
  onlyJobId: string | null = null,
) {
  const now = new Date();
  const eligible: Prisma.OutboxWhereInput = {
    ...(onlyJobId ? { id: onlyJobId } : {}),
    availableAt: { lte: now },
    attempts: { lt: 8 },
    AND: [
      { OR: [{ processedAt: null }, { processedAt: { isSet: false } }] },
      {
        OR: [
          { leaseUntil: null },
          { leaseUntil: { isSet: false } },
          { leaseUntil: { lte: now } },
        ],
      },
    ],
  };
  const job = await database.outbox.findFirst({
    where: eligible,
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
  });
  if (!job) return false;
  const leaseToken = randomUUID();
  const claim = await database.outbox.updateMany({
    where: { AND: [eligible, { id: job.id }] },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + 120000) },
  });
  if (!claim.count) return false;

  try {
    await database.$transaction(
      async (tx) => {
        const current = await tx.outbox.findUniqueOrThrow({
          where: { id: job.id },
        });
        if (current.processedAt || current.leaseToken !== leaseToken) return;
        const payload = job.payload as any;
        if (job.kind === "EMAIL")
          await deliverEmail({
            from: process.env.SMTP_FROM,
            ...openMailPayload(job.payload),
            messageId: `<${job.id}@project-operations.local>`,
          });
        else if (job.kind === "SCAN") {
          if (!process.env.MALWARE_SCAN_URL)
            throw new Error("Malware scanning service is not configured");
          const document = await tx.document.findUniqueOrThrow({
            where: { id: payload.documentId },
          });
          const object = await storage().send(
            new GetObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: document.objectKey,
            }),
          );
          if (
            object.ContentLength !== document.size ||
            document.size > 10485760
          )
            throw new Error("File size mismatch");
          const bytes = Buffer.from(await object.Body!.transformToByteArray());
          const signature =
            document.mimeType === "application/pdf"
              ? bytes.subarray(0, 5).toString() === "%PDF-"
              : document.mimeType === "image/png"
                ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
                : bytes.subarray(0, 3).toString("hex") === "ffd8ff";
          if (!signature) {
            await tx.document.update({
              where: { id: document.id },
              data: { status: "REJECTED" },
            });
          } else {
            const result = await fetch(process.env.MALWARE_SCAN_URL, {
              method: "POST",
              body: bytes,
              headers: {
                "Content-Type": "application/octet-stream",
                ...(process.env.MALWARE_SCAN_TOKEN
                  ? {
                      Authorization: `Bearer ${process.env.MALWARE_SCAN_TOKEN}`,
                    }
                  : {}),
              },
              signal: AbortSignal.timeout(15000),
            });
            if (!result.ok) throw new Error("Scanner unavailable");
            const scanned = (await result.json()) as { clean: boolean };
            if (scanned.clean === true) {
              const key = `${document.orgId}/${document.projectId}/clean/${randomUUID()}`;
              await storage().send(
                new PutObjectCommand({
                  Bucket: process.env.S3_BUCKET,
                  Key: key,
                  Body: bytes,
                  ContentType: document.mimeType,
                }),
              );
              await tx.document.update({
                where: { id: document.id },
                data: { status: "CLEAN", objectKey: key },
              });
            } else
              await tx.document.update({
                where: { id: document.id },
                data: { status: "REJECTED" },
              });
          }
        } else if (job.kind !== "NOTIFICATION")
          throw new Error("Unknown job kind");
        await tx.outbox.update({
          where: { id: job.id },
          data: {
            processedAt: new Date(),
            ...(job.kind === "EMAIL" ? { payload: {} } : {}),
            attempts: { increment: 1 },
            lastError: null,
            leaseToken: null,
            leaseUntil: null,
          },
        });
        log.info({ jobId: job.id, kind: job.kind }, "Job completed");
      },
      { timeout: 60000 },
    );
  } catch {
    await database.outbox.updateMany({
      where: {
        id: job.id,
        leaseToken,
        OR: [{ processedAt: null }, { processedAt: { isSet: false } }],
      },
      data: {
        attempts: { increment: 1 },
        availableAt: new Date(
          Date.now() + Math.min(3600000, 10000 * 2 ** job.attempts),
        ),
        lastError:
          "Job delivery failed; verify configured dependency availability",
        leaseToken: null,
        leaseUntil: null,
      },
    });
    log.error(
      { jobId: job.id, kind: job.kind, attempt: job.attempts + 1 },
      "Job failed",
    );
  }
  return true;
}
async function overdue() {
  const tasks = await db.task.findMany({
    where: { status: { not: "DONE" }, dueDate: { lt: new Date() } },
    take: 1000,
  });
  for (const t of tasks)
    await db.outbox.upsert({
      where: {
        dedupeKey: `overdue:${t.id}:${new Date().toISOString().slice(0, 10)}`,
      },
      create: {
        orgId: t.orgId,
        kind: "NOTIFICATION",
        projectId: t.projectId,
        dedupeKey: `overdue:${t.id}:${new Date().toISOString().slice(0, 10)}`,
        payload: {
          projectId: t.projectId,
          message: `Overdue task: ${t.title}`,
        },
      },
      update: {},
    });
}
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  let nextSweep = 0;
  while (!stopping) {
    try {
      if (Date.now() > nextSweep) {
        await overdue();
        nextSweep = Date.now() + 3600000;
      }
      if (!(await runJob())) await new Promise((r) => setTimeout(r, 3000));
    } catch {
      log.error("Worker database failure");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await db.$disconnect();
}
if (process.env.NODE_ENV !== "test") void main();
