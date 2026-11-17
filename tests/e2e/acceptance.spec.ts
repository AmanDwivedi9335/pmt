import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { openMailPayload } from "../../apps/api/src/mail-payload";
config();
test("organization completes setup, import, receipt, independent installation approval, invoicing and payment", async ({
  page,
  browser,
}) => {
  const id = randomUUID(),
    email = `browser-${id}@example.test`,
    password = "browser-acceptance-secret-123";
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an organization", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Aman Operations");
  await page
    .getByLabel("Organization", { exact: true })
    .fill("Acceptance workspace");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: false }).fill(password);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project dashboard" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const directEmail = `direct-${id}@example.test`;
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  const staffDialog = page.getByRole("dialog");
  await staffDialog.getByLabel("Full name").fill("Direct staff");
  await staffDialog.getByLabel("Email address").fill(directEmail);
  await staffDialog.getByLabel("Role").selectOption({ label: "SITE ENGINEER" });
  await staffDialog.getByLabel("Initial password").fill(password);
  await staffDialog.getByRole("button", { name: "Confirm & save" }).click();
  await expect(
    page
      .getByRole("row", { name: /Direct staff/ })
      .getByText("Active", { exact: true }),
  ).toBeVisible();
  const directStaff = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  await directStaff.goto("/");
  await directStaff.getByLabel("Email address").fill(directEmail);
  await directStaff.getByLabel("Password", { exact: false }).fill(password);
  await directStaff
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    directStaff.getByRole("heading", { name: "Site engineer dashboard" }),
  ).toBeVisible();
  await directStaff.close();
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  const teamDialog = page.getByRole("dialog");
  await teamDialog.getByLabel("Team name").fill("Field operations");
  await teamDialog.getByRole("button", { name: "Confirm & save" }).click();
  await page
    .getByRole("row", { name: /Field operations/ })
    .getByRole("button", { name: "Manage members" })
    .click();
  const group = page.getByRole("region", { name: "Team members" });
  await group.getByRole("button", { name: "Add member", exact: true }).click();
  await teamDialog.getByLabel("Staff email").fill(email);
  await teamDialog.getByRole("button", { name: "Confirm & save" }).click();
  await expect(group.getByText(email, { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await page.getByRole("button", { name: "Client", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("Client name").fill("Bagmane");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page.getByRole("button", { name: "Materials", exact: true }).click();
  await page.getByRole("button", { name: "Add material", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("SKU / code").fill("BPG");
  await modal.getByLabel("Material name").fill("Bounce Pillar Guard");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Project name").fill("Bagmane Capital Tech Park");
  await modal.getByLabel("Project code").fill("BCTP");
  await modal
    .getByLabel("Client", { exact: false })
    .selectOption({ label: "Bagmane" });
  await modal.getByLabel("City").fill("Bangalore");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: "Bagmane Capital Tech Park" }),
    })
    .click();
  await page
    .getByRole("button", { name: "Work Orders", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Work order", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Work order number").fill("4500016760");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page.getByRole("button", { name: "BOQ item", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Catalog material")
    .selectOption({ label: "Bounce Pillar Guard" });
  await modal.getByLabel("Approved order quantity").fill("2600");
  await modal.getByLabel("Contracted supply rate").fill("100");
  await modal.getByLabel("Installation rate").fill("20");
  await modal.getByLabel("Revision reason").fill("Initial approved contract");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  for (const next of ["PLANNED", "ACTIVE"]) {
    await page
      .getByRole("button", { name: "Change status", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal.getByLabel("Next status").selectOption(next);
    await modal
      .getByLabel("Reason", { exact: false })
      .fill("Approved for site operations");
    await modal.getByRole("button", { name: "Confirm & save" }).click();
    await expect(modal).not.toBeVisible();
  }
  await page.getByRole("button", { name: "BOQ", exact: true }).click();
  await page.getByRole("button", { name: "Import tracker" }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Excel or CSV tracker")
    .setInputFiles(path.resolve("tests/fixtures/bagmane-acceptance.csv"));
  await modal.getByRole("button", { name: "Preview import" }).click();
  await expect(
    modal.getByText("Detected header at row 6.", { exact: false }),
  ).toBeVisible();
  await modal.getByLabel("Opening balance as-of date").fill("2026-01-01");
  await modal.getByRole("checkbox").check();
  await modal.getByRole("button", { name: "Confirm opening balances" }).click();
  await expect(modal).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Bounce Pillar Guard" });
  await expect(
    row.getByRole("cell", { name: "2,600", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("cell", { name: "308", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Supply", exact: true }).click();
  await page
    .getByRole("button", { name: "Goods receipt", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Material / BOQ item").selectOption({ index: 1 });
  await modal.getByLabel("Quantity", { exact: false }).fill("100");
  await modal.getByLabel("Delivery / challan reference").fill("BROWSER-DC-01");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByText("receipt:BROWSER-DC-01")).toBeVisible();
  await page.getByRole("button", { name: "BOQ", exact: true }).click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Bounce Pillar Guard" })
      .getByRole("cell", { name: "408", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/auth/me")).json(),
    orgId = me.memberships[0].orgId,
    headers = {
      Origin: new URL(page.url()).origin,
      "x-organization-id": orgId,
      "x-csrf-token": me.csrf,
    };
  const project = (
      await (await page.request.get("/api/v1/projects", { headers })).json()
    ).rows.find((p: any) => p.code === "BCTP"),
    roles = await (
      await page.request.get("/api/v1/organizations/roles", { headers })
    ).json(),
    siteEmail = `site-${id}@example.test`;
  const invite = await (
    await page.request.post("/api/v1/organizations/invitations", {
      headers,
      data: {
        email: siteEmail,
        roleId: roles.find((r: any) => r.name === "SITE_ENGINEER").id,
      },
    })
  ).json();
  // Read the test invitation from the database-backed outbox; no live email dependency is simulated.
  const db = new PrismaClient();
  let inviteToken: string;
  try {
    const job = await db.outbox.findUniqueOrThrow({
      where: { dedupeKey: `invite:${invite.id}` },
    });
    inviteToken = openMailPayload(job.payload).text.split("invite=")[1];
  } finally {
    await db.$disconnect();
  }
  const engineer = await browser.newPage({
    baseURL: new URL(page.url()).origin,
    geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 20 },
    permissions: ["geolocation"],
  });
  await engineer.goto(`/#invite=${inviteToken}`);
  await engineer.getByLabel("Your name").fill("Site Engineer");
  await engineer.getByLabel("Password", { exact: false }).fill(password);
  await engineer.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    engineer.getByRole("heading", { name: "Site engineer dashboard" }),
  ).toBeVisible();
  const team = await (
      await page.request.get("/api/v1/organizations/team", { headers })
    ).json(),
    member = team.find((m: any) => m.user.email === siteEmail);
  expect(
    (
      await page.request.post(`/api/v1/projects/${project.id}/members`, {
        headers,
        data: { membershipId: member.id },
      })
    ).status(),
  ).toBe(201);
  const authorizedMedia: {
    name: string;
    mimeType: string;
    siteVisitId: string;
  }[] = [];
  const punchPhotos = new Set<string>();
  const uploadedBytes: string[] = [];
  const completedMedia: string[] = [];
  const siteDocuments = `/api/v1/projects/${project.id}/documents/`;
  // Stub storage and verification while attendance uses the real API.
  await engineer.route(`**${siteDocuments}upload`, async (route) => {
    const input = route.request().postDataJSON();
    let uploadId = input.name;
    if (input.punchPhoto) {
      const photo = await db.document.create({
        data: {
          ...input,
          orgId: member.orgId,
          projectId: project.id,
          createdBy: member.user.id,
          objectKey: randomUUID(),
        },
      });
      uploadId = photo.id;
      punchPhotos.add(uploadId);
    } else {
      authorizedMedia.push(input);
    }
    await route.fulfill({
      json: { id: uploadId, url: `/test-site-storage/${uploadId}` },
    });
  });
  await engineer.route("**/test-site-storage/*", async (route) => {
    expect(route.request().method()).toBe("PUT");
    uploadedBytes.push(route.request().postData()!);
    await route.fulfill({ status: 200, body: "" });
  });
  await engineer.route(`**${siteDocuments}*/complete`, async (route) => {
    const documentId = new URL(route.request().url()).pathname
      .split("/")
      .at(-2)!;
    if (punchPhotos.has(documentId)) {
      await db.$transaction([
        db.document.update({
          where: { id: documentId },
          data: { status: "CLEAN" },
        }),
        db.outbox.create({
          data: {
            orgId: member.orgId,
            kind: "SCAN",
            dedupeKey: `scan:${documentId}`,
            payload: { documentId },
            processedAt: new Date(),
          },
        }),
      ]);
    } else {
      completedMedia.push(documentId);
    }
    await route.fulfill({ json: { status: "QUARANTINED" } });
  });
  await engineer.reload();
  const punchIn = engineer.getByRole("button", {
    name: "Punch in",
    exact: true,
  });
  await expect(punchIn).toBeDisabled();
  await engineer
    .getByLabel("Project", { exact: true })
    .selectOption(project.id);
  await expect(punchIn).toBeDisabled();
  await engineer.getByLabel("Punch-in photo").setInputFiles({
    name: "arrival.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("arrival photo"),
  });
  await punchIn.click();
  await expect(engineer.getByText("You’re punched in.")).toBeVisible();
  await expect(
    engineer.getByText("12.97160, 77.59460", { exact: false }),
  ).toBeVisible();
  await engineer.reload();
  await expect(engineer.getByText("You’re punched in.")).toBeVisible();
  await expect(
    engineer.getByLabel("Media project", { exact: true }),
  ).toHaveValue(project.id);
  await expect(
    engineer.getByRole("button", { name: "Project recorded" }),
  ).toBeDisabled();
  await engineer
    .getByLabel("Site photos and videos", { exact: false })
    .setInputFiles([
      {
        name: "site.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("photo"),
      },
      { name: "site.mp4", mimeType: "video/mp4", buffer: Buffer.from("video") },
    ]);
  await engineer.getByRole("button", { name: "Upload site media" }).click();
  await expect(
    engineer.getByText("2 files uploaded and awaiting verification."),
  ).toBeVisible();
  expect(authorizedMedia).toMatchObject([
    {
      name: "site.jpg",
      mimeType: "image/jpeg",
      siteVisitId: expect.any(String),
    },
    {
      name: "site.mp4",
      mimeType: "video/mp4",
      siteVisitId: expect.any(String),
    },
  ]);
  expect(authorizedMedia[0].siteVisitId).toBe(authorizedMedia[1].siteVisitId);
  expect(uploadedBytes).toEqual(["arrival photo", "photo", "video"]);
  expect(completedMedia).toEqual(["site.jpg", "site.mp4"]);
  await engineer
    .context()
    .setGeolocation({ latitude: 12.972, longitude: 77.595, accuracy: 30 });
  const punchOut = engineer.getByRole("button", {
    name: "Punch out",
    exact: true,
  });
  await expect(punchOut).toBeDisabled();
  await engineer.getByLabel("Punch-out photo").setInputFiles({
    name: "departure.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("departure photo"),
  });
  await punchOut.click();
  await expect(
    engineer.getByText("Your last visit is complete."),
  ).toBeVisible();
  await expect(
    engineer.getByText("12.97200, 77.59500", { exact: false }),
  ).toBeVisible();
  await expect(
    engineer.getByRole("button", { name: "Upload site media" }),
  ).toHaveCount(0);
  expect(uploadedBytes.at(-1)).toBe("departure photo");
  await db.$disconnect();
  const assignedTask = await page.request.post(
    `/api/v1/projects/${project.id}/tasks`,
    {
      headers,
      data: { title: "Check installation photos", assigneeId: member.user.id },
    },
  );
  expect(assignedTask.status()).toBe(201);
  await engineer.getByRole("button", { name: "My work", exact: true }).click();
  const assignedStatus = engineer.getByLabel(
    "Status for Check installation photos",
  );
  await expect(assignedStatus).toBeVisible();
  await assignedStatus.selectOption("IN_PROGRESS");
  await expect(assignedStatus).toHaveValue("IN_PROGRESS");
  await assignedStatus.selectOption("IN_REVIEW");
  const assignedRow = engineer.getByRole("row", {
    name: /Check installation photos/,
  });
  await expect(
    assignedRow.getByText("IN REVIEW", { exact: true }),
  ).toBeVisible();
  const assigned = await assignedTask.json();
  const approved = await page.request.patch(
    `/api/v1/projects/${project.id}/tasks/${assigned.id}`,
    {
      headers,
      data: { status: "DONE", version: assigned.version + 2 },
    },
  );
  expect(approved.status()).toBe(200);
  await engineer
    .getByRole("navigation")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await engineer
    .getByRole("button")
    .filter({
      has: engineer.getByRole("heading", { name: "Bagmane Capital Tech Park" }),
    })
    .click();
  await engineer
    .getByRole("button", { name: "Installation", exact: true })
    .last()
    .click();
  await engineer
    .getByRole("button", { name: "New report", exact: true })
    .click();
  let reportModal = engineer.getByRole("dialog");
  await reportModal
    .getByLabel("Material", { exact: false })
    .selectOption({ index: 1 });
  await reportModal.getByLabel("Installed quantity").fill("40");
  await reportModal.getByLabel("Floor / zone / area").fill("Basement A");
  await reportModal.getByLabel("Progress date").fill("2026-10-01");
  await reportModal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(reportModal).not.toBeVisible();
  await engineer.getByRole("button", { name: "Submit", exact: true }).click();
  reportModal = engineer.getByRole("dialog");
  await reportModal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(reportModal).not.toBeVisible();
  await engineer.close();
  await page
    .getByRole("button", { name: "Installation", exact: true })
    .last()
    .click();
  for (const action of ["Verify", "Approve"]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "Confirm & save" }).click();
    await expect(modal).not.toBeVisible();
  }
  await page
    .getByRole("button", { name: "Billing", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Draft invoice" }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Invoice number").fill("INV-BROWSER-01");
  await modal.getByLabel("Billing type").selectOption("INSTALLATION");
  await modal.getByLabel("Eligible material").selectOption({ index: 1 });
  await modal.getByLabel("Quantity", { exact: false }).fill("40");
  await modal.getByLabel("Payment due date").fill("2026-11-15");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await page.getByRole("button", { name: "Payment", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Amount received", { exact: false }).fill("200");
  await modal.getByLabel("Bank / payment reference").fill("BROWSER-UTR-001");
  await modal.getByLabel("Received date").fill("2026-10-20");
  await modal.getByRole("button", { name: "Confirm & save" }).click();
  await expect(modal).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "₹744", exact: true }),
  ).toBeVisible();
  for (const format of ["Excel", "PDF"]) {
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    const download = await downloadEvent;
    await download.saveAs(
      `.local/acceptance-report.${format === "PDF" ? "pdf" : "xlsx"}`,
    );
  }
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByText("₹2,60,000", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".local/portal-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/portal-mobile.png", fullPage: true });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Project dashboard" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(".profile").click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: false }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Project portfolio" })
      .getByText("₹744", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Attendance reports", exact: true })
    .click();
  const table = page.getByRole("table", {
    name: "Employee attendance by project",
  });
  const engineerRow = table
    .getByRole("row")
    .filter({ hasText: "Site Engineer" })
    .filter({ hasText: "Bagmane Capital Tech Park" });
  await expect(engineerRow).toBeVisible();
  await engineerRow.getByText("View visit", { exact: true }).click();
  await expect(
    engineerRow.getByText("12.97160, 77.59460", { exact: false }),
  ).toBeVisible();
  await expect(
    engineerRow.getByText("12.97200, 77.59500", { exact: false }),
  ).toBeVisible();
  await expect(
    engineerRow.getByRole("button", { name: "Download punch-in photo" }),
  ).toBeVisible();
  await expect(
    engineerRow.getByRole("button", { name: "Download punch-out photo" }),
  ).toBeVisible();
  await page.getByLabel("Period", { exact: false }).selectOption("monthly");
  await page.getByLabel("Employee", { exact: true }).fill(siteEmail);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(engineerRow).toBeVisible();
});
