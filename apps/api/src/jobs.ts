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
  return database.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          kind: string;
          payload: Prisma.JsonValue;
          attempts: number;
        }[]
      >`SELECT * FROM "Outbox" WHERE "processedAt" IS NULL AND "availableAt" <= NOW() AND "attempts" < 8 AND (${onlyJobId}::uuid IS NULL OR "id"=${onlyJobId}::uuid) ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      const job = rows[0];
      if (!job) return false;
      try {
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
          },
        });
        log.info({ jobId: job.id, kind: job.kind }, "Job completed");
      } catch {
        await tx.outbox.update({
          where: { id: job.id },
          data: {
            attempts: { increment: 1 },
            availableAt: new Date(
              Date.now() + Math.min(3600000, 10000 * 2 ** job.attempts),
            ),
            lastError:
              "Job delivery failed; verify configured dependency availability",
          },
        });
        log.error(
          { jobId: job.id, kind: job.kind, attempt: job.attempts + 1 },
          "Job failed",
        );
      }
      return true;
    },
    { timeout: 60000 },
  );
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
