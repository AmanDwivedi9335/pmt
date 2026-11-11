import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app";
import { Db } from "../apps/api/src/db";
import { openMailPayload } from "../apps/api/src/mail-payload";
import { hash } from "../apps/api/src/security";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "mongodb://127.0.0.1:27018/pmt_test?replicaSet=pmt&directConnection=true";
process.env.IDENTITY_MAIL_KEY = "a".repeat(64);
process.env.APP_ORIGIN = "http://localhost:3000";
const origin = "http://localhost:3000";
let app: any, db: Db, agent: any, csrf: string, orgId: string, userId: string;
const unique = Date.now();
export const apiState: any = {};
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Tests require a dedicated *_test database");
  app = await createApp();
  db = app.get(Db);
  await db.loginAttempt.deleteMany();
  agent = request.agent(app.getHttpServer());
});
afterAll(async () => {
  await app?.close();
});
describe("phase 1 identity and tenant boundary", () => {
  it("registers a real organization and configures the role catalog", async () => {
    const r = await agent
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .send({
        email: `admin-${unique}@example.test`,
        password: "correct-horse-portal-123",
        name: "Operations Admin",
        organization: "Tenant A",
      });
    expect(r.status).toBe(201);
    expect(r.headers["set-cookie"][0]).toContain("HttpOnly");
    csrf = r.body.csrf;
    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    orgId = me.body.memberships[0].orgId;
    userId = me.body.user.id;
    expect(me.body.memberships[0].role.name).toBe("ORGANIZATION_ADMIN");
    expect(await db.role.count({ where: { orgId } })).toBe(9);
    Object.assign(apiState, { agent, csrf, orgId, userId, app, db });
  });
  it("rejects missing session, wrong Origin, and missing CSRF", async () => {
    expect(
      (await request(app.getHttpServer()).get("/api/v1/auth/me")).status,
    ).toBe(401);
    expect(
      (
        await agent
          .post("/api/v1/organizations")
          .set("Origin", "https://evil.test")
          .send({ name: "Evil" })
      ).status,
    ).toBe(403);
    expect(
      (
        await agent
          .post("/api/v1/organizations")
          .set("Origin", origin)
          .send({ name: "No token" })
      ).status,
    ).toBe(403);
  });
  it("denies cross-organization access", async () => {
    const other = request.agent(app.getHttpServer());
    await other
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .send({
        email: `other-${unique}@example.test`,
        password: "correct-horse-portal-456",
        name: "Other Admin",
        organization: "Tenant B",
      });
    const me = await other.get("/api/v1/auth/me");
    expect(
      (
        await agent
          .get("/api/v1/organizations/team")
          .set("x-organization-id", me.body.memberships[0].orgId)
      ).status,
    ).toBe(403);
  });
  it("consumes a reset token once and revokes existing sessions", async () => {
    const r = await agent
      .post("/api/v1/auth/forgot-password")
      .set("Origin", origin)
      .send({ email: `admin-${unique}@example.test` });
    expect(r.status).toBe(201);
    const resetToken = await db.identityToken.findFirstOrThrow({
      where: { userId, usedAt: null },
    });
    const outbox = await db.outbox.findUniqueOrThrow({
      where: { dedupeKey: `reset:${resetToken.tokenHash}` },
    });
    const raw = openMailPayload(outbox.payload).text.split("reset=")[1];
    const body = { token: raw, password: "changed-horse-portal-789" };
    expect(
      (
        await agent
          .post("/api/v1/auth/reset-password")
          .set("Origin", origin)
          .send(body)
      ).status,
    ).toBe(201);
    expect(
      (
        await agent
          .post("/api/v1/auth/reset-password")
          .set("Origin", origin)
          .send(body)
      ).status,
    ).toBe(401);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email: `admin-${unique}@example.test`, password: body.password });
    csrf = login.body.csrf;
    apiState.csrf = csrf;
    expect(login.status).toBe(201);
  });
  it("persists membership across logout and rejects revoked sessions", async () => {
    const me = await agent.get("/api/v1/auth/me");
    expect(me.body.memberships[0].orgId).toBe(orgId);
    expect(
      (
        await agent
          .post("/api/v1/auth/logout")
          .set("Origin", origin)
          .set("x-csrf-token", csrf)
      ).status,
    ).toBe(201);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({
        email: `admin-${unique}@example.test`,
        password: "changed-horse-portal-789",
      });
    csrf = login.body.csrf;
    apiState.csrf = csrf;
  });
  it("stores only hashed session tokens", async () => {
    const s = await db.session.findFirstOrThrow({ where: { userId } });
    expect(s.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash("not-the-token")).not.toBe(s.tokenHash);
  });
  it("lists and revokes only the caller's sessions", async () => {
    const another = request.agent(app.getHttpServer());
    const login = await another
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({
        email: `admin-${unique}@example.test`,
        password: "changed-horse-portal-789",
      });
    expect(login.status).toBe(201);
    const list = await agent.get("/api/v1/auth/sessions");
    expect(list.status).toBe(200);
    expect(
      list.body.filter((session: { current: boolean }) => session.current),
    ).toHaveLength(1);
    const other = list.body.find(
      (session: { current: boolean }) => !session.current,
    );
    expect(other).not.toHaveProperty("tokenHash");
    expect(other).not.toHaveProperty("csrf");
    const revoke = await agent
      .delete(`/api/v1/auth/sessions/${other.id}`)
      .set("Origin", origin)
      .set("x-csrf-token", csrf);
    expect(revoke.status).toBe(200);
    expect((await another.get("/api/v1/auth/me")).status).toBe(401);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
  });
  it("honors the configured session lifetime without trusting client input", async () => {
    const previous = process.env.SESSION_DAYS;
    try {
      process.env.SESSION_DAYS = "2";
      const result = await agent
        .post("/api/v1/auth/renew")
        .set("Origin", origin)
        .set("x-csrf-token", csrf);
      expect(result.status).toBe(201);
      csrf = result.body.csrf;
      apiState.csrf = csrf;
      const saved = await db.session.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      const remaining = saved.expiresAt.getTime() - Date.now();
      expect(remaining).toBeGreaterThan(2 * 86400000 - 30000);
      expect(remaining).toBeLessThanOrEqual(2 * 86400000);
    } finally {
      if (previous === undefined) delete process.env.SESSION_DAYS;
      else process.env.SESSION_DAYS = previous;
    }
  });
  it("accepts invitations once and immediately applies membership revocation", async () => {
    const role = await db.role.findUniqueOrThrow({
        where: { orgId_name: { orgId, name: "SITE_ENGINEER" } },
      }),
      address = `invited-${unique}@example.test`;
    const invite = await agent
      .post("/api/v1/organizations/invitations")
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("x-organization-id", orgId)
      .send({ email: address, roleId: role.id });
    expect(invite.status).toBe(201);
    const job = await db.outbox.findUniqueOrThrow({
        where: { dedupeKey: `invite:${invite.body.id}` },
      }),
      raw = openMailPayload(job.payload).text.split("invite=")[1];
    expect(JSON.stringify(job.payload)).not.toContain(raw);
    const invited = request.agent(app.getHttpServer()),
      body = {
        token: raw,
        name: "Invited engineer",
        password: "invitation-test-secret-123",
      };
    expect(
      (
        await invited
          .post("/api/v1/auth/accept-invitation")
          .set("Origin", origin)
          .send(body)
      ).status,
    ).toBe(201);
    expect(
      (
        await invited
          .post("/api/v1/auth/accept-invitation")
          .set("Origin", origin)
          .send(body)
      ).status,
    ).toBe(401);
    expect(
      (await invited.get("/api/v1/projects").set("x-organization-id", orgId))
        .status,
    ).toBe(200);
    const member = await db.membership.findFirstOrThrow({
      where: { orgId, user: { email: address } },
    });
    expect(
      (
        await agent
          .patch(`/api/v1/organizations/members/${member.id}`)
          .set("Origin", origin)
          .set("x-csrf-token", csrf)
          .set("x-organization-id", orgId)
          .send({ roleId: role.id, active: false })
      ).status,
    ).toBe(200);
    expect(
      (await invited.get("/api/v1/projects").set("x-organization-id", orgId))
        .status,
    ).toBe(403);
  });
  it("prevents duplicate invitations and rejects expired, replaced, and revoked links", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { orgId_name: { orgId, name: "SITE_ENGINEER" } },
    });
    const path = "/api/v1/organizations/invitations";
    const send = (target: string) =>
      agent
        .post(target)
        .set("Origin", origin)
        .set("x-csrf-token", csrf)
        .set("x-organization-id", orgId);
    const input = {
      email: `lifecycle-${unique}@example.test`,
      roleId: role.id,
    };
    const created = await send(path).send(input);
    expect(created.status).toBe(201);
    expect(
      (await send(path).send({ ...input, email: input.email.toUpperCase() }))
        .status,
    ).toBe(409);
    const id = created.body.id;
    const readLink = async (key: string) => {
      const job = await db.outbox.findFirstOrThrow({
        where: { dedupeKey: { startsWith: key } },
      });
      return openMailPayload(job.payload).text.split("invite=")[1];
    };
    const accept = (token: string) =>
      request(app.getHttpServer())
        .post("/api/v1/auth/accept-invitation")
        .set("Origin", origin)
        .send({
          token,
          name: "Lifecycle engineer",
          password: "invitation-test-secret-123",
        });
    const original = await readLink(`invite:${id}`);
    await db.invitation.update({
      where: { id },
      data: { expiresAt: new Date(0) },
    });
    expect((await accept(original)).status).toBe(401);
    expect((await send(`${path}/${id}/resend`)).status).toBe(201);
    const replaced = await readLink(`invite:${id}:`);
    expect(replaced).not.toBe(original);
    expect((await accept(original)).status).toBe(401);
    expect((await send(`${path}/${id}/revoke`)).status).toBe(201);
    expect((await accept(replaced)).status).toBe(401);
    const list = await agent.get(path).set("x-organization-id", orgId);
    expect(list.body.rows).toContainEqual(
      expect.objectContaining({ id, revokedAt: expect.any(String) }),
    );
    expect(
      list.body.rows.find((row: { id: string }) => row.id === id),
    ).not.toHaveProperty("tokenHash");
  });
  it("lets an administrator create active staff with an initial password", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { orgId_name: { orgId, name: "SITE_ENGINEER" } },
    });
    const path = "/api/v1/organizations/staff";
    const headers = {
      Origin: origin,
      "x-csrf-token": csrf,
      "x-organization-id": orgId,
    };
    const email = `direct-staff-${unique}@example.test`;
    const password = "initial-staff-secret-123";
    const input = {
      name: "Direct Staff",
      email: email.toUpperCase(),
      roleId: role.id,
      password,
    };
    const created = await agent.post(path).set(headers).send(input);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      active: true,
      roleId: role.id,
      user: { email },
    });
    expect(JSON.stringify(created.body)).not.toContain(password);
    expect(created.body.user).not.toHaveProperty("passwordHash");
    expect(await db.invitation.count({ where: { orgId, email } })).toBe(0);
    expect((await agent.post(path).set(headers).send(input)).status).toBe(409);
    const staff = request.agent(app.getHttpServer());
    const login = await staff
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email, password });
    expect(login.status).toBe(201);
    const profile = await staff.get("/api/v1/auth/me");
    expect(profile.body.memberships).toContainEqual(
      expect.objectContaining({ orgId, roleId: role.id }),
    );
    expect(
      (
        await staff
          .post(path)
          .set({ ...headers, "x-csrf-token": login.body.csrf })
          .send(input)
      ).status,
    ).toBe(403);
  });
  it("manages team groups and isolates their membership by organization", async () => {
    const path = "/api/v1/organizations/teams";
    const headers = {
      Origin: origin,
      "x-csrf-token": csrf,
      "x-organization-id": orgId,
    };
    const created = await agent
      .post(path)
      .set(headers)
      .send({ name: "Field Team" });
    expect(created.status).toBe(201);
    expect(
      (await agent.post(path).set(headers).send({ name: "field team" })).status,
    ).toBe(409);
    const teamPath = `${path}/${created.body.id}`;
    const address = `admin-${unique}@example.test`;
    expect(
      (
        await agent
          .post(`${teamPath}/members`)
          .set(headers)
          .send({ email: address })
      ).status,
    ).toBe(201);
    expect(
      (
        await agent
          .post(`${teamPath}/members`)
          .set(headers)
          .send({ email: address })
      ).status,
    ).toBe(201);
    const members = await agent.get(`${teamPath}/members`).set(headers);
    expect(members.body.total).toBe(1);
    expect(members.body.rows[0].membership.user.email).toBe(address);
    const foreignOrg = await db.organization.create({
      data: { name: "Unrelated team tenant" },
    });
    const foreignTeam = await db.team.create({
      data: {
        orgId: foreignOrg.id,
        name: "Unrelated team",
        normalizedName: "unrelated team",
      },
    });
    expect(
      (await agent.get(`${path}/${foreignTeam.id}/members`).set(headers))
        .status,
    ).toBe(404);
    expect(
      (await agent.delete(`${path}/${foreignTeam.id}`).set(headers)).status,
    ).toBe(404);
    expect(
      (
        await agent
          .delete(`${teamPath}/members/${members.body.rows[0].membershipId}`)
          .set(headers)
      ).status,
    ).toBe(200);
    expect((await agent.delete(teamPath).set(headers)).status).toBe(200);
  });
  it("prevents removal of the last administrator and supports organization configuration", async () => {
    const member = await db.membership.findUniqueOrThrow({
      where: { orgId_userId: { orgId, userId } },
    });
    expect(
      (
        await agent
          .patch(`/api/v1/organizations/members/${member.id}`)
          .set("Origin", origin)
          .set("x-csrf-token", csrf)
          .set("x-organization-id", orgId)
          .send({ roleId: member.roleId, active: false })
      ).status,
    ).toBe(409);
    const result = await agent
      .patch("/api/v1/organizations")
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("x-organization-id", orgId)
      .send({ name: "Tenant A updated", currency: "INR" });
    expect(result.status).toBe(200);
    expect(result.body.name).toBe("Tenant A updated");
  });
  it("renews a session by replacing its token and invalidating the old one", async () => {
    const login = await agent
        .post("/api/v1/auth/login")
        .set("Origin", origin)
        .send({
          email: `admin-${unique}@example.test`,
          password: "changed-horse-portal-789",
        }),
      oldCookie = login.headers["set-cookie"][0].split(";")[0];
    csrf = login.body.csrf;
    const renewed = await agent
      .post("/api/v1/auth/renew")
      .set("Origin", origin)
      .set("x-csrf-token", csrf);
    expect(renewed.status).toBe(201);
    csrf = renewed.body.csrf;
    expect(
      (
        await request(app.getHttpServer())
          .get("/api/v1/auth/me")
          .set("Cookie", oldCookie)
      ).status,
    ).toBe(401);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
  });
  it("enforces persistent login rate limits", async () => {
    for (let n = 0; n < 10; n++)
      expect(
        (
          await request(app.getHttpServer())
            .post("/api/v1/auth/login")
            .set("Origin", origin)
            .send({
              email: `missing-${unique}@example.test`,
              password: "bad-password-1234",
            })
        ).status,
      ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post("/api/v1/auth/login")
          .set("Origin", origin)
          .send({
            email: `missing-${unique}@example.test`,
            password: "bad-password-1234",
          })
      ).status,
    ).toBe(429);
  });
});
