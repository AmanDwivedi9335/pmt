import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { Db } from "../apps/api/src/db";
import { passwordHash } from "../apps/api/src/security";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://pmt@127.0.0.1:5435/pmt_test";
process.env.APP_ORIGIN = "http://localhost:3000";
let app: any,
  db: Db,
  agent: any,
  orgId: string,
  csrf: string,
  projectId: string,
  woId: string,
  itemId: string,
  materialId: string,
  engineer: any,
  engineerCsrf: string;
const unique = randomUUID();
function post(path: string, body: any = {}, key?: string) {
  const r = agent
    .post(`/api/v1/${path}`)
    .set("Origin", process.env.APP_ORIGIN)
    .set("x-csrf-token", csrf)
    .set("x-organization-id", orgId);
  if (key) r.set("idempotency-key", key);
  return r.send(body);
}
function get(path: string) {
  return agent.get(`/api/v1/${path}`).set("x-organization-id", orgId);
}
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  app = await createApp();
  db = app.get(Db);
  await db.loginAttempt.deleteMany();
  agent = request.agent(app.getHttpServer());
  const r = await agent
    .post("/api/v1/auth/register")
    .set("Origin", process.env.APP_ORIGIN)
    .send({
      email: `ops-${unique}@example.test`,
      name: "Operations",
      organization: "Operations test",
      password: "operations-test-secret-123",
    });
  expect(r.status).toBe(201);
  csrf = r.body.csrf;
  orgId = (await agent.get("/api/v1/auth/me")).body.memberships[0].orgId;
});
afterAll(async () => {
  await app?.close();
});
describe("phase 2 project vertical slice", () => {
  it("creates client, project, site, contacts, catalog, work order and BOQ", async () => {
    const client = await post("clients", { name: "Bagmane" });
    expect(client.status).toBe(201);
    const project = await post("projects", {
      name: "Bagmane Capital Tech Park",
      code: "BCTP",
      clientId: client.body.id,
      city: "Bangalore",
    });
    expect(project.status, JSON.stringify(project.body)).toBe(201);
    projectId = project.body.id;
    expect(
      (await post(`projects/${projectId}/sites`, { name: "Main site" })).status,
    ).toBe(201);
    expect(
      (
        await post(`projects/${projectId}/contacts`, {
          name: "Site Engineer",
          role: "Engineer in-charge",
        })
      ).status,
    ).toBe(201);
    const material = await post("materials", {
      sku: "BPG",
      name: "Bounce Pillar Guard",
      uom: "Nos",
      precision: 0,
    });
    expect(material.status).toBe(201);
    materialId = material.body.id;
    const wo = await post(`projects/${projectId}/work-orders`, {
      number: "4500016760",
    });
    woId = wo.body.id;
    const item = await post(`projects/${projectId}/work-orders/${woId}/items`, {
      materialId,
      ordered: "2600",
      supplyRate: "100",
      installationRate: "20",
      taxRate: "18",
      reason: "Initial contract",
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    itemId = item.body.id;
    expect(
      (await get(`projects/${projectId}`)).body.workOrders[0].items[0].ordered,
    ).toBe("2600");
  });
  it("enforces project workflow and preserves versions", async () => {
    expect(
      (
        await post(`projects/${projectId}/status`, {
          status: "CLOSED",
          version: 1,
          reason: "Invalid shortcut",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(`projects/${projectId}/status`, {
          status: "PLANNED",
          version: 1,
          reason: "Planning complete",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(`projects/${projectId}/status`, {
          status: "ACTIVE",
          version: 1,
          reason: "Stale update",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(`projects/${projectId}/status`, {
          status: "ACTIVE",
          version: 2,
          reason: "Site mobilized",
        })
      ).status,
    ).toBe(201);
    expect(
      await db.workOrderRevision.count({ where: { workOrderId: woId } }),
    ).toBe(1);
    expect(
      (await post(`projects/${projectId}/work-orders/${woId}/approve`)).status,
    ).toBe(201);
  });
  it("restricts staff to assigned projects and forbids invoice approval", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { orgId_name: { orgId, name: "SITE_ENGINEER" } },
    });
    const user = await db.user.create({
      data: {
        name: "Engineer",
        email: `engineer-${unique}@example.test`,
        passwordHash: await passwordHash("engineer-test-secret-123"),
      },
    });
    const member = await db.membership.create({
      data: { orgId, userId: user.id, roleId: role.id },
    });
    engineer = request.agent(app.getHttpServer());
    const login = await engineer
      .post("/api/v1/auth/login")
      .set("Origin", process.env.APP_ORIGIN)
      .send({ email: user.email, password: "engineer-test-secret-123" });
    engineerCsrf = login.body.csrf;
    expect(
      (
        await engineer
          .get(`/api/v1/projects/${projectId}`)
          .set("x-organization-id", orgId)
      ).status,
    ).toBe(404);
    expect(
      (await post(`projects/${projectId}/members`, { membershipId: member.id }))
        .status,
    ).toBe(201);
    expect(
      (
        await engineer
          .get(`/api/v1/projects/${projectId}`)
          .set("x-organization-id", orgId)
      ).status,
    ).toBe(200);
    expect(
      (
        await engineer
          .post(`/api/v1/projects/${projectId}/work-orders/${woId}/approve`)
          .set("Origin", process.env.APP_ORIGIN)
          .set("x-csrf-token", engineerCsrf)
          .set("x-organization-id", orgId)
      ).status,
    ).toBe(403);
  });
});
const tracker =
  "Project,BAGMANE CAPILTAL TEAH PARK\nLocation,Bangalore\nWork order,4500016760\n\nMaterial,Ordered Qty,Supplied Qty,Pending Supply,Installed at Site,Pending Installation,Supplied Billed Qty,Installation Billed Qty\nBounce Pillar Guard,2600,500,2100,192,2408,0,0";
describe("phase 3 historical import", () => {
  it("finds the header below metadata and imports confirmed openings without inventing events", async () => {
    const source = {
      fileName: "reference-fixture.csv",
      content: Buffer.from(tracker).toString("base64"),
    };
    const preview = await post(`projects/${projectId}/imports/preview`, source);
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    expect(preview.body.headerRow).toBe(5);
    expect(preview.body.metadata[0].values[1]).toBe(
      "BAGMANE CAPILTAL TEAH PARK",
    );
    expect(preview.body.hasErrors).toBe(false);
    const confirmed = await post(`projects/${projectId}/imports/confirm`, {
      ...source,
      workOrderId: woId,
      asOf: "2026-01-01",
      confirmed: true,
      acceptedReceiptAssumption: true,
      acknowledgeWarnings: true,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
    expect(await db.stockMovement.count({ where: { projectId } })).toBe(0);
    expect(await db.invoice.count({ where: { projectId } })).toBe(0);
    expect(
      (
        await db.openingBalance.findFirstOrThrow({
          where: { boqItemId: itemId },
        })
      ).installed.toString(),
    ).toBe("192");
    expect(
      (
        await post(`projects/${projectId}/imports/confirm`, {
          ...source,
          workOrderId: woId,
          asOf: "2026-01-01",
          confirmed: true,
          acceptedReceiptAssumption: true,
          acknowledgeWarnings: true,
        })
      ).status,
    ).toBe(409);
  });
  it("blocks inconsistent quantities and leaves no partial batch", async () => {
    const source = {
      fileName: "bad.csv",
      content: Buffer.from(tracker.replace("500,2100", "500,2000")).toString(
        "base64",
      ),
    };
    const preview = await post(`projects/${projectId}/imports/preview`, source);
    expect(preview.body.hasErrors).toBe(true);
    const before = await db.importBatch.count({ where: { projectId } });
    expect(
      (
        await post(`projects/${projectId}/imports/confirm`, {
          ...source,
          workOrderId: woId,
          asOf: "2026-01-01",
          confirmed: true,
          acceptedReceiptAssumption: true,
          acknowledgeWarnings: true,
        })
      ).status,
    ).toBe(409);
    expect(await db.importBatch.count({ where: { projectId } })).toBe(before);
  });
});
describe("phase 4 procurement and immutable stock", () => {
  it("shows acceptance balances without invented stock movements", async () => {
    const b = (await get(`projects/${projectId}/balances`)).body[0];
    expect(b.pendingSupply).toBe("2100");
    expect(b.pendingInstallation).toBe("2408");
    expect(b.available).toBe("308");
  });
  it("approves a PO, dispatches and records a partial receipt with damaged goods", async () => {
    const supplier = await post("suppliers", {
      name: "Safety materials supplier",
    });
    const po = await post(
      `projects/${projectId}/purchase-orders`,
      {
        number: "PO-001",
        supplierId: supplier.body.id,
        lines: [{ boqItemId: itemId, quantity: "100", rate: "80" }],
      },
      randomUUID(),
    );
    expect(po.status, JSON.stringify(po.body)).toBe(201);
    expect(
      (
        await post(
          `projects/${projectId}/purchase-orders/${po.body.id}/approve`,
        )
      ).status,
    ).toBe(201);
    const dispatch = await post(
      `projects/${projectId}/dispatches`,
      {
        purchaseLineId: po.body.lines[0].id,
        quantity: "100",
        challan: "DC-001",
      },
      randomUUID(),
    );
    expect(dispatch.status).toBe(201);
    const key = randomUUID(),
      body = {
        dispatchId: dispatch.body.id,
        reference: "GR-001",
        accepted: "50",
        damaged: "10",
        rejected: "0",
      };
    const receipt = await post(
      `projects/${projectId}/goods-receipts`,
      body,
      key,
    );
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    expect(
      (await post(`projects/${projectId}/goods-receipts`, body, key)).body.id,
    ).toBe(receipt.body.id);
    expect(
      (await get(`projects/${projectId}/balances`)).body[0].available,
    ).toBe("358");
    expect(
      (
        await post(
          `projects/${projectId}/goods-receipts`,
          { ...body, reference: "GR-002", accepted: "50" },
          randomUUID(),
        )
      ).status,
    ).toBe(409);
  });
  it("makes receipt retries idempotent and rejects changed payloads with reused keys", async () => {
    const key = randomUUID(),
      body = { boqItemId: itemId, quantity: "100", reference: "DIRECT-001" };
    const r = await post(`projects/${projectId}/receipts`, body, key);
    expect(r.status).toBe(201);
    const retry = await post(`projects/${projectId}/receipts`, body, key);
    expect(retry.body.id).toBe(r.body.id);
    expect(
      (
        await post(
          `projects/${projectId}/receipts`,
          { ...body, quantity: "101" },
          key,
        )
      ).status,
    ).toBe(409);
    expect(
      await db.stockMovement.count({
        where: { projectId, reference: "receipt:DIRECT-001" },
      }),
    ).toBe(1);
  });
  it("records returns with a compensating ledger entry and prevents negative stock", async () => {
    expect(
      (
        await post(
          `projects/${projectId}/returns`,
          {
            boqItemId: itemId,
            quantity: "8",
            reference: "RETURN-1",
            reason: "Unused goods returned",
          },
          randomUUID(),
        )
      ).status,
    ).toBe(201);
    expect(
      (await get(`projects/${projectId}/balances`)).body[0].available,
    ).toBe("450");
    expect(
      (
        await post(
          `projects/${projectId}/returns`,
          {
            boqItemId: itemId,
            quantity: "451",
            reference: "RETURN-2",
            reason: "Excess return blocked",
          },
          randomUUID(),
        )
      ).status,
    ).toBe(409);
    const movement = await db.stockMovement.findFirstOrThrow({
      where: { projectId },
    });
    await expect(
      db.stockMovement.update({
        where: { id: movement.id },
        data: { quantity: "1" },
      }),
    ).rejects.toThrow();
  });
});
let approvedInstallation: any;
async function engineerPost(path: string, body: any, key = randomUUID()) {
  return engineer
    .post(`/api/v1/${path}`)
    .set("Origin", process.env.APP_ORIGIN)
    .set("x-csrf-token", engineerCsrf)
    .set("x-organization-id", orgId)
    .set("idempotency-key", key)
    .send(body);
}
async function verifiedReport(q: string) {
  const r = await engineerPost(`projects/${projectId}/installations`, {
    boqItemId: itemId,
    quantity: q,
    area: "Basement zone A",
    reportDate: "2026-10-01",
  });
  expect(r.status).toBe(201);
  expect(
    (
      await engineerPost(
        `projects/${projectId}/installations/${r.body.id}/transition`,
        { status: "SUBMITTED", version: 1 },
      )
    ).status,
  ).toBe(201);
  const v = await post(
    `projects/${projectId}/installations/${r.body.id}/transition`,
    { status: "VERIFIED", version: 2 },
    randomUUID(),
  );
  expect(v.status).toBe(201);
  return v.body;
}
describe("phase 5 installation approvals", () => {
  it("prevents concurrent approvals from overspending available stock", async () => {
    const a = await verifiedReport("300"),
      b = await verifiedReport("300");
    const results = await Promise.all(
      [a, b].map((r) =>
        post(
          `projects/${projectId}/installations/${r.id}/transition`,
          { status: "APPROVED", version: 3 },
          randomUUID(),
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    approvedInstallation = results.find((r) => r.status === 201)!.body;
    expect(
      (await get(`projects/${projectId}/balances`)).body[0].available,
    ).toBe("150");
    const failed = [a, b].find((r) => r.id !== approvedInstallation.id);
    expect(
      (
        await post(
          `projects/${projectId}/installations/${failed.id}/transition`,
          { status: "REJECTED", version: 3 },
          randomUUID(),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(
          `projects/${projectId}/installations/${failed.id}/transition`,
          {
            status: "REJECTED",
            version: 3,
            reason: "Not enough accepted stock",
          },
          randomUUID(),
        )
      ).status,
    ).toBe(201);
  });
  it("reverses approved work without changing its original consumption entry", async () => {
    expect(
      (
        await post(
          `projects/${projectId}/installations/${approvedInstallation.id}/transition`,
          {
            status: "REVERSED",
            version: 4,
            reason: "Correction following site review",
          },
          randomUUID(),
        )
      ).status,
    ).toBe(201);
    expect(
      (await get(`projects/${projectId}/balances`)).body[0].available,
    ).toBe("450");
    expect(
      await db.stockMovement.count({
        where: {
          projectId,
          reference: `installation:${approvedInstallation.id}`,
        },
      }),
    ).toBe(2);
    const opening = (
      await get(`projects/${projectId}/balances?asOf=2026-01-01`)
    ).body[0];
    expect(opening.available).toBe("308");
    expect(opening.installed).toBe("192");
  });
  it("approves additional installation through the required workflow", async () => {
    const report = await verifiedReport("40");
    const r = await post(
      `projects/${projectId}/installations/${report.id}/transition`,
      { status: "APPROVED", version: 3 },
      randomUUID(),
    );
    expect(r.status).toBe(201);
    expect(
      (await get(`projects/${projectId}/balances`)).body[0].installed,
    ).toBe("232");
  });
});
let issuedInvoice: any;
describe("phase 6 billing and payments", () => {
  it("blocks unauthorized invoice approval", async () => {
    expect(
      (
        await engineerPost(
          `projects/${projectId}/invoices/${randomUUID()}/issue`,
          {},
        )
      ).status,
    ).toBe(403);
  });
  it("atomically issues quantities once under competing issuance requests", async () => {
    const invoices = [];
    for (let n = 0; n < 2; n++) {
      const r = await post(
        `projects/${projectId}/invoices`,
        {
          number: `INV-${n}`,
          kind: "INSTALLATION",
          dueDate: "2026-10-15",
          lines: [{ boqItemId: itemId, quantity: "200" }],
        },
        randomUUID(),
      );
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      invoices.push(r.body);
    }
    const issued = await Promise.all(
      invoices.map((i) =>
        post(`projects/${projectId}/invoices/${i.id}/issue`, {}, randomUUID()),
      ),
    );
    expect(issued.map((r) => r.status).sort()).toEqual([201, 409]);
    issuedInvoice = issued.find((r) => r.status === 201)!.body;
    expect(issuedInvoice.total).toBe("4720");
    expect(
      (await get(`projects/${projectId}/balances`)).body[0]
        .installationUnbilled,
    ).toBe("32");
  });
  it("persists a partial payment and rejects over-allocation without partial writes", async () => {
    const body = {
        amount: "1000",
        reference: "UTR-001",
        receivedAt: "2026-10-20",
        allocations: [{ invoiceId: issuedInvoice.id, amount: "1000" }],
      },
      key = randomUUID();
    const payment = await post(`projects/${projectId}/payments`, body, key);
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    expect(
      (await post(`projects/${projectId}/payments`, body, key)).body.id,
    ).toBe(payment.body.id);
    const invoice = (await get(`projects/${projectId}/invoices`)).body.find(
      (i: any) => i.id === issuedInvoice.id,
    );
    expect(invoice.paid).toBe("1000.00");
    expect(invoice.outstanding).toBe("3720.00");
    const before = await db.payment.count({ where: { projectId } });
    expect(
      (
        await post(
          `projects/${projectId}/payments`,
          {
            amount: "4000",
            reference: "UTR-002",
            receivedAt: "2026-10-20",
            allocations: [{ invoiceId: issuedInvoice.id, amount: "4000" }],
          },
          randomUUID(),
        )
      ).status,
    ).toBe(409);
    expect(await db.payment.count({ where: { projectId } })).toBe(before);
    expect(
      (
        await post(
          `projects/${projectId}/invoices/${issuedInvoice.id}/cancel`,
          { reason: "Cannot cancel paid invoice" },
          randomUUID(),
        )
      ).status,
    ).toBe(409);
  });
  it("prevents allocated installation reversal until financial corrections are resolved", async () => {
    const approved = await db.installation.findFirstOrThrow({
      where: { projectId, status: "APPROVED" },
    });
    expect(
      (
        await post(
          `projects/${projectId}/installations/${approved.id}/transition`,
          {
            status: "REVERSED",
            version: approved.version,
            reason: "Would invalidate invoice quantity",
          },
          randomUUID(),
        )
      ).status,
    ).toBe(409);
  });
});
describe("phase 7 collaboration and reporting", () => {
  it("persists tasks with optimistic versions and aggregates authorized live metrics", async () => {
    const task = await post(`projects/${projectId}/tasks`, {
      title: "Inspect basement installation",
      priority: "HIGH",
      dueDate: "2026-01-01",
    });
    expect(task.status).toBe(201);
    const update = await agent
      .patch(`/api/v1/projects/${projectId}/tasks/${task.body.id}`)
      .set("Origin", process.env.APP_ORIGIN)
      .set("x-csrf-token", csrf)
      .set("x-organization-id", orgId)
      .send({ version: 1, status: "IN_PROGRESS" });
    expect(update.status).toBe(200);
    expect(
      (
        await agent
          .patch(`/api/v1/projects/${projectId}/tasks/${task.body.id}`)
          .set("Origin", process.env.APP_ORIGIN)
          .set("x-csrf-token", csrf)
          .set("x-organization-id", orgId)
          .send({ version: 1, status: "DONE" })
      ).status,
    ).toBe(409);
    const reminder = await post(`projects/${projectId}/tasks`, {
      title: "Schedule the final inspection",
      dueDate: "2099-01-01",
    });
    expect(reminder.status).toBe(201);
    const dashboard = await get("dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.totalProjects).toBe(1);
    expect(dashboard.body.orderValue).toBe("260000.00");
    expect(dashboard.body.invoiced).toBe("4720.00");
    expect(dashboard.body.outstanding).toBe("3720.00");
    expect(dashboard.body.overdueTasks).toBe(1);
    expect(dashboard.body.projects[0]).toMatchObject({
      id: projectId,
      attention: {
        outstanding: "3720.00",
        overdueTasks: [{ id: task.body.id, status: "IN_PROGRESS" }],
        upcomingTasks: [
          { id: reminder.body.id, title: "Schedule the final inspection" },
        ],
        unscheduledTasks: [],
      },
    });
  });
  it("lists a staff member's assigned work and only permits their own progress updates", async () => {
    const profile = await engineer.get("/api/v1/auth/me");
    const assigneeId = profile.body.user.id;
    const taskPath = `projects/${projectId}/tasks`;
    const assigned = await post(taskPath, {
      title: "Assigned inspection",
      assigneeId,
    });
    const unassigned = await post(taskPath, { title: "Unassigned inspection" });
    expect(assigned.status).toBe(201);
    expect(unassigned.status).toBe(201);
    expect(
      (
        await engineerPost(taskPath, {
          title: "Unauthorized assignment",
          assigneeId,
        })
      ).status,
    ).toBe(403);
    const list = await engineer
      .get("/api/v1/workspace/my-tasks")
      .set("x-organization-id", orgId);
    expect(list.status).toBe(200);
    expect(list.body.rows.map((task: { id: string }) => task.id)).toEqual([
      assigned.body.id,
    ]);
    const progress = (id: string, body: unknown) =>
      engineer
        .patch(`/api/v1/${taskPath}/${id}`)
        .set("Origin", process.env.APP_ORIGIN)
        .set("x-csrf-token", engineerCsrf)
        .set("x-organization-id", orgId)
        .send(body);
    expect(
      (
        await progress(unassigned.body.id, {
          status: "IN_PROGRESS",
          version: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await progress(assigned.body.id, {
          status: "IN_PROGRESS",
          version: 1,
          assigneeId: null,
        })
      ).status,
    ).toBe(400);
    expect(
      (await progress(assigned.body.id, { status: "IN_PROGRESS", version: 1 }))
        .status,
    ).toBe(200);
    expect(
      (await progress(assigned.body.id, { status: "BLOCKED", version: 1 }))
        .status,
    ).toBe(409);
    expect(
      (await progress(assigned.body.id, { status: "DONE", version: 2 })).status,
    ).toBe(400);
    expect(
      (await progress(assigned.body.id, { status: "IN_REVIEW", version: 2 }))
        .status,
    ).toBe(200);
    expect(
      (await progress(assigned.body.id, { status: "BLOCKED", version: 3 }))
        .status,
    ).toBe(403);
    const review = await agent
      .patch(`/api/v1/${taskPath}/${assigned.body.id}`)
      .set("Origin", process.env.APP_ORIGIN)
      .set("x-csrf-token", csrf)
      .set("x-organization-id", orgId)
      .send({ status: "DONE", version: 3 });
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("DONE");
  });
  it("exports real project quantities and billing to an Excel workbook", async () => {
    const response = await get(`projects/${projectId}/export`)
      .buffer(true)
      .parse((response: any, done: any) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    expect(response.headers["content-disposition"]).toContain("BCTP");
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 2).toString()).toBe("PK");
    const pdf = await get(`projects/${projectId}/export.pdf`)
      .buffer(true)
      .parse((response: any, done: any) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      (
        await engineer
          .get(`/api/v1/projects/${projectId}/export`)
          .set("x-organization-id", orgId)
      ).status,
    ).toBe(403);
  });
  it("keeps quarantined documents private and rejects oversized files before storage authorization", async () => {
    const doc = await db.document.create({
      data: {
        orgId,
        projectId,
        name: "Inspection.pdf",
        objectKey: `${orgId}/quarantine/${randomUUID()}`,
        mimeType: "application/pdf",
        size: 100,
        createdBy: (await db.membership.findFirstOrThrow({ where: { orgId } }))
          .userId,
      },
    });
    expect(
      (await get(`projects/${projectId}/documents/${doc.id}/download`)).status,
    ).toBe(404);
    expect(
      (
        await post(`projects/${projectId}/documents/upload`, {
          name: "oversize.pdf",
          mimeType: "application/pdf",
          size: 11000000,
        })
      ).status,
    ).toBe(400);
  });
});
