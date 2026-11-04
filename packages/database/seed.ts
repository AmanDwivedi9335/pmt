import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { passwordHash, hash } from "../../apps/api/src/security";
import { roleDefaults, email, password } from "../shared/src";
config();
async function main() {
  if (process.env.NODE_ENV !== "development")
    throw new Error("Demo seed is permitted only with NODE_ENV=development");
  const address = email.parse(process.env.SEED_EMAIL),
    secret = password.parse(process.env.SEED_PASSWORD);
  const db = new PrismaClient();
  try {
    if (await db.user.findUnique({ where: { email: address } }))
      throw new Error(
        "Seed account already exists; refusing to modify existing data",
      );
    const encoded = await passwordHash(secret),
      source = readFileSync("tests/fixtures/bagmane-acceptance.csv", "utf8");
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
          data: {
            email: address,
            name: "Demo Administrator",
            passwordHash: encoded,
          },
        }),
        org = await tx.organization.create({
          data: { name: "Fieldwork Demo (development only)" },
        });
      for (const [name, permissions] of Object.entries(roleDefaults))
        await tx.role.create({ data: { orgId: org.id, name, permissions } });
      const role = await tx.role.findUniqueOrThrow({
        where: { orgId_name: { orgId: org.id, name: "ORGANIZATION_ADMIN" } },
      });
      const member = await tx.membership.create({
          data: { orgId: org.id, userId: user.id, roleId: role.id },
        }),
        client = await tx.client.create({
          data: { orgId: org.id, name: "Bagmane (acceptance fixture)" },
        });
      const project = await tx.project.create({
        data: {
          orgId: org.id,
          clientId: client.id,
          name: "Bagmane Capital Tech Park",
          code: "DEMO-BCTP",
          city: "Bangalore",
          status: "ACTIVE",
          description:
            "Development acceptance fixture. Not the missing original reference tracker.",
          members: { create: { membershipId: member.id } },
        },
      });
      await tx.site.create({
        data: {
          orgId: org.id,
          projectId: project.id,
          name: "Main project site",
        },
      });
      const material = await tx.material.create({
          data: {
            orgId: org.id,
            sku: "BPG",
            name: "Bounce Pillar Guard",
            uom: "Nos",
            precision: 0,
            standardRate: "100",
            taxRate: "18",
          },
        }),
        wo = await tx.workOrder.create({
          data: {
            orgId: org.id,
            projectId: project.id,
            number: "4500016760",
            approvedAt: new Date(),
          },
        });
      const item = await tx.boqItem.create({
        data: {
          orgId: org.id,
          workOrderId: wo.id,
          materialId: material.id,
          ordered: "2600",
          supplyRate: "100",
          installationRate: "20",
          taxRate: "18",
        },
      });
      const batch = await tx.importBatch.create({
        data: {
          orgId: org.id,
          projectId: project.id,
          sourceHash: hash(Buffer.from(source).toString("base64")),
          sourceName: "bagmane-acceptance.csv (development fixture)",
          asOf: new Date("2026-01-01"),
          source: source.split("\n").map((r) => r.split(",")),
          mapping: { acceptedReceiptAssumption: true, fixture: true },
        },
      });
      await tx.openingBalance.create({
        data: {
          orgId: org.id,
          batchId: batch.id,
          boqItemId: item.id,
          supplied: "500",
          installed: "192",
          supplyBilled: "0",
          installationBilled: "0",
          sourceRow: 7,
        },
      });
      await tx.audit.create({
        data: {
          orgId: org.id,
          actorId: user.id,
          action: "development.fixture.seeded",
          resourceId: project.id,
          detail: {
            source:
              "User prompt acceptance fixture; no original workbook supplied",
          },
        },
      });
    });
    console.log(
      "Development fixture created. Sign in with the SEED_EMAIL and SEED_PASSWORD you supplied.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exitCode = 1;
});
