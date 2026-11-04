import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  NotFoundException,
  Param,
  Req,
  Res,
  Inject,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { Db } from "./db";
import { sealIdentityMail } from "./mail-payload";
import type { Prisma } from "@prisma/client";
import {
  Security,
  audit,
  hash,
  parse,
  passwordHash,
  passwordMatches,
  token,
} from "./security";
import {
  z,
  email,
  password,
  roleDefaults,
  uuid,
  permissions,
} from "@pmt/shared";
const credentials = z.object({ email, password });
const dummyPasswordHash = passwordHash(token());
@Injectable()
export class AuthService {
  constructor(@Inject(Db) readonly db: Db) {}
  async limit(key: string, max = 10) {
    const result = await this.db.$queryRaw<
      { count: number }[]
    >`INSERT INTO "LoginAttempt" ("key","count","windowAt") VALUES (${hash(key)},1,NOW()) ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "LoginAttempt"."windowAt" < NOW()-INTERVAL '15 minutes' THEN 1 ELSE "LoginAttempt"."count"+1 END, "windowAt"=CASE WHEN "LoginAttempt"."windowAt" < NOW()-INTERVAL '15 minutes' THEN NOW() ELSE "LoginAttempt"."windowAt" END RETURNING "count"`;
    if (result[0].count > max)
      throw new HttpException(
        "Too many attempts. Try again in 15 minutes.",
        429,
      );
  }
  async issue(userId: string, res: Response) {
    const raw = token(),
      csrf = token();
    const expiresAt = new Date(
      Date.now() + Number(process.env.SESSION_DAYS || 7) * 86400000,
    );
    await this.db.session.create({
      data: { userId, tokenHash: hash(raw), csrf, expiresAt },
    });
    res.cookie("pmt_session", raw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    return { csrf };
  }
  async createOrganization(tx: any, userId: string, name: string) {
    const org = await tx.organization.create({ data: { name } });
    for (const [name, permissions] of Object.entries(roleDefaults))
      await tx.role.create({ data: { orgId: org.id, name, permissions } });
    const role = await tx.role.findUniqueOrThrow({
      where: { orgId_name: { orgId: org.id, name: "ORGANIZATION_ADMIN" } },
    });
    await tx.membership.create({
      data: { orgId: org.id, userId, roleId: role.id },
    });
    await tx.audit.create({
      data: {
        orgId: org.id,
        actorId: userId,
        action: "organization.created",
        resourceId: org.id,
        detail: {},
      },
    });
    return org;
  }
}
@ApiTags("Identity and organization")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(Security) readonly security: Security,
    @Inject(Db) readonly db: Db,
  ) {}
  @Post("register") async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(
      credentials.extend({
        name: z.string().trim().min(2).max(100),
        organization: z.string().trim().min(2).max(150),
      }),
      body,
    );
    await this.auth.limit(`register:${req.ip}`, 5);
    if (await this.db.user.findUnique({ where: { email: input.email } }))
      throw new ConflictException("Account already exists");
    const encoded = await passwordHash(input.password);
    const user = await this.db.serial(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash: encoded },
      });
      await this.auth.createOrganization(tx, user.id, input.organization);
      return user;
    });
    return this.auth.issue(user.id, res);
  }
  @Post("login") async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(credentials, body);
    await this.auth.limit(`login-ip:${req.ip}`, 40);
    await this.auth.limit(`login-email:${input.email}`);
    const user = await this.db.user.findUnique({
      where: { email: input.email },
    });
    const valid = await passwordMatches(
      input.password,
      user?.passwordHash || (await dummyPasswordHash),
    );
    await this.db.audit.create({
      data: {
        actorId: user?.id,
        action: valid ? "auth.login" : "auth.login.failed",
        detail: { emailHash: hash(input.email), ipHash: hash(req.ip || "") },
      },
    });
    if (!user || !valid)
      throw new UnauthorizedException("Email or password is incorrect");
    return this.auth.issue(user.id, res);
  }
  @Get("me") async me(@Req() req: Request) {
    const s = await this.security.session(req);
    const memberships = await this.db.membership.findMany({
      where: { userId: s.userId, active: true },
      include: { organization: true, role: true },
    });
    return { user: s.user, csrf: s.csrf, memberships };
  }
  @Post("logout") async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.security.session(req);
    await this.db.session.delete({ where: { id: s.id } });
    res.clearCookie("pmt_session", { path: "/" });
    return { ok: true };
  }
  @Post("renew") async renew(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.security.session(req);
    await this.db.session.delete({ where: { id: s.id } });
    return this.auth.issue(s.userId, res);
  }
  @Post("revoke-all") async revoke(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.security.session(req);
    await this.db.session.deleteMany({ where: { userId: s.userId } });
    res.clearCookie("pmt_session", { path: "/" });
    return { ok: true };
  }
  @Get("sessions") async sessions(@Req() req: Request) {
    const current = await this.security.session(req);
    const sessions = await this.db.session.findMany({
      where: { userId: current.userId, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.id === current.id,
    }));
  }
  @Delete("sessions/:id") async removeSession(
    @Req() req: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const current = await this.security.session(req);
    const sessionId = parse(uuid, id);
    await this.db.$transaction(async (tx) => {
      const deleted = await tx.session.deleteMany({
        where: { id: sessionId, userId: current.userId },
      });
      if (!deleted.count) throw new NotFoundException("Session not found");
      await tx.audit.create({
        data: {
          actorId: current.userId,
          action: "auth.session.revoked",
          resourceId: sessionId,
          detail: {},
        },
      });
    });
    if (sessionId === current.id) res.clearCookie("pmt_session", { path: "/" });
    return { ok: true };
  }
  @Post("change-password") async changePassword(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const current = await this.security.session(req);
    await this.auth.limit(`change-password:${current.userId}`);
    const input = parse(
      z.object({ currentPassword: password, newPassword: password }),
      body,
    );
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: current.userId },
    });
    if (!(await passwordMatches(input.currentPassword, user.passwordHash)))
      throw new UnauthorizedException("Current password is incorrect");
    const encoded = await passwordHash(input.newPassword);
    await this.db.serial(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: encoded },
      });
      if (!updated.count)
        throw new ConflictException("Password changed. Sign in again.");
      await tx.identityToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.audit.create({
        data: { actorId: user.id, action: "auth.password.changed", detail: {} },
      });
    });
    res.clearCookie("pmt_session", { path: "/" });
    return { ok: true };
  }
  @Post("forgot-password") async forgot(
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = parse(z.object({ email }), body);
    await this.auth.limit(`reset:${req.ip}`, 5);
    const user = await this.db.user.findUnique({
      where: { email: input.email },
    });
    if (user) {
      const raw = token();
      await this.db.$transaction(async (tx) => {
        await tx.identityToken.create({
          data: {
            userId: user.id,
            tokenHash: hash(raw),
            expiresAt: new Date(Date.now() + 3600000),
          },
        });
        await tx.outbox.create({
          data: {
            kind: "EMAIL",
            dedupeKey: `reset:${hash(raw)}`,
            payload: sealIdentityMail({
              to: user.email,
              subject: "Reset your password",
              text: `Reset your password: ${process.env.APP_ORIGIN}/#reset=${raw}`,
            }),
          },
        });
      });
    }
    return {
      message: "If this email is registered, a reset link has been queued.",
    };
  }
  @Post("reset-password") async reset(
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    await this.auth.limit(`reset-accept:${req.ip}`);
    const input = parse(
        z.object({ token: z.string().min(40).max(100), password }),
        body,
      ),
      encoded = await passwordHash(input.password);
    await this.db.serial(async (tx) => {
      const t = await tx.identityToken.findUnique({
        where: { tokenHash: hash(input.token) },
      });
      if (!t || t.usedAt || t.expiresAt < new Date())
        throw new UnauthorizedException("Reset link is invalid or expired");
      await tx.identityToken.updateMany({
        where: { userId: t.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: t.userId },
        data: { passwordHash: encoded },
      });
      await tx.session.deleteMany({ where: { userId: t.userId } });
      await tx.audit.create({
        data: { actorId: t.userId, action: "auth.password.reset", detail: {} },
      });
    });
    return { ok: true };
  }
  @Post("accept-invitation") async accept(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.limit(`invite-accept:${req.ip}`);
    const input = parse(
      z.object({
        token: z.string().min(40).max(100),
        name: z.string().min(2).max(100),
        password,
      }),
      body,
    );
    const encoded = await passwordHash(input.password);
    const user = await this.db.serial(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hash(input.token) },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt < new Date()
      )
        throw new UnauthorizedException("Invitation is invalid or expired");
      let user = await tx.user.findUnique({
        where: { email: invitation.email },
      });
      if (user) {
        if (!(await passwordMatches(input.password, user.passwordHash)))
          throw new UnauthorizedException("Use your existing account password");
      } else
        user = await tx.user.create({
          data: {
            email: invitation.email,
            name: input.name,
            passwordHash: encoded,
          },
        });
      const existing = await tx.membership.findUnique({
        where: { orgId_userId: { orgId: invitation.orgId, userId: user.id } },
      });
      if (existing)
        throw new ConflictException(
          "A membership already exists. Ask an administrator to manage access.",
        );
      await tx.membership.create({
        data: {
          orgId: invitation.orgId,
          userId: user.id,
          roleId: invitation.roleId,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await tx.audit.create({
        data: {
          orgId: invitation.orgId,
          actorId: user.id,
          action: "member.invitation.accepted",
          resourceId: invitation.id,
          detail: {},
        },
      });
      return user;
    });
    return this.auth.issue(user.id, res);
  }
}
@ApiTags("Organization administration")
@Controller("organizations")
export class OrganizationController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
    @Inject(AuthService) readonly auth: AuthService,
  ) {}
  @Patch() async configure(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.security.context(req, "organization.manage"),
      input = parse(
        z.object({
          name: z.string().trim().min(2).max(150).optional(),
          currency: z
            .enum(["INR", "USD", "EUR", "GBP", "AED", "SGD"])
            .optional(),
        }),
        body,
      );
    return this.db.serial(async (tx) => {
      if (input.currency) {
        const invoices = await tx.invoice.count({
          where: { orgId: ctx.orgId },
        });
        if (invoices)
          throw new ConflictException(
            "Currency cannot change after invoicing begins",
          );
      }
      const row = await tx.organization.update({
        where: { id: ctx.orgId },
        data: input,
      });
      await audit(tx, ctx, "organization.configured", ctx.orgId, input);
      return row;
    });
  }
  @Patch("members/:member") async configureMember(
    @Req() req: Request,
    @Param("member") memberId: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "team.manage"),
      input = parse(z.object({ roleId: uuid, active: z.boolean() }), body);
    return this.db.serial(async (tx) => {
      const member = await tx.membership.findFirst({
          where: { id: parse(uuid, memberId), orgId: ctx.orgId },
          include: { role: true },
        }),
        role = await tx.role.findFirst({
          where: { id: input.roleId, orgId: ctx.orgId },
        });
      if (!member || !role)
        throw new ConflictException("Membership or role is unavailable");
      if (
        !member.role.permissions.every((p) => ctx.permissions.includes(p)) ||
        !role.permissions.every((p) => ctx.permissions.includes(p))
      )
        throw new ConflictException("Cannot grant permissions you do not hold");
      if (
        member.role.permissions.includes("organization.manage") &&
        (!input.active || !role.permissions.includes("organization.manage"))
      ) {
        const remaining = await tx.membership.count({
          where: {
            orgId: ctx.orgId,
            id: { not: member.id },
            active: true,
            role: { permissions: { has: "organization.manage" } },
          },
        });
        if (!remaining)
          throw new ConflictException(
            "Keep at least one active organization administrator",
          );
      }
      if (member.userId === ctx.userId && input.roleId !== member.roleId)
        throw new ConflictException(
          "Another administrator must change your role",
        );
      const updated = await tx.membership.update({
        where: { id: member.id },
        data: input,
      });
      await audit(tx, ctx, "membership.configured", member.id, input);
      return updated;
    });
  }
  @Post() async create(@Req() req: Request, @Body() body: unknown) {
    const s = await this.security.session(req);
    const input = parse(z.object({ name: z.string().min(2).max(150) }), body);
    return this.db.serial((tx) =>
      this.auth.createOrganization(tx, s.userId, input.name),
    );
  }
  @Get("team") async team(@Req() req: Request) {
    const ctx = await this.security.context(req, "team.manage");
    return this.db.membership.findMany({
      where: { orgId: ctx.orgId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        role: true,
        projectAccess: true,
      },
    });
  }
  @Post("staff") async createStaff(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.security.context(req, "organization.manage");
    if (!ctx.permissions.includes("team.manage"))
      throw new ForbiddenException("Staff management permission is required");
    const input = parse(
      credentials
        .extend({
          name: z.string().trim().min(2).max(100),
          roleId: uuid,
        })
        .strict(),
      body,
    );
    await this.auth.limit(`staff-create:${ctx.membershipId}`, 30);
    const encoded = await passwordHash(input.password);
    return this.db.serial(async (tx) => {
      const role = await tx.role.findFirstOrThrow({
        where: { id: input.roleId, orgId: ctx.orgId },
      });
      if (
        !role.permissions.every((permission) =>
          ctx.permissions.includes(permission),
        )
      )
        throw new ForbiddenException(
          "Cannot grant permissions you do not hold",
        );
      if (
        await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        })
      )
        throw new ConflictException(
          "An account already uses this email. Use membership management or invite the existing account.",
        );
      const user = await tx.user.create({
        data: { name: input.name, email: input.email, passwordHash: encoded },
        select: { id: true, name: true, email: true },
      });
      const membership = await tx.membership.create({
        data: {
          orgId: ctx.orgId,
          roleId: role.id,
          userId: user.id,
          active: true,
        },
        select: { id: true, active: true, roleId: true },
      });
      const invitations = await tx.invitation.findMany({
        where: {
          orgId: ctx.orgId,
          email: input.email,
          acceptedAt: null,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (invitations.length) {
        await tx.invitation.updateMany({
          where: { id: { in: invitations.map(({ id }) => id) } },
          data: { revokedAt: new Date() },
        });
        await tx.outbox.deleteMany({
          where: {
            orgId: ctx.orgId,
            processedAt: null,
            OR: invitations.flatMap(({ id }) => [
              { dedupeKey: `invite:${id}` },
              { dedupeKey: { startsWith: `invite:${id}:` } },
            ]),
          },
        });
      }
      await audit(tx, ctx, "member.created", membership.id, {
        roleId: role.id,
        revokedInvitationIds: invitations.map(({ id }) => id),
      });
      return { ...membership, user };
    });
  }
  @Get("staff") async staff(@Req() req: Request, @Query() query: unknown) {
    const ctx = await this.security.context(req, "team.manage");
    const input = parse(
      z.object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        search: z.string().trim().max(100).default(""),
        access: z.enum(["all", "active", "inactive"]).default("all"),
        sort: z.enum(["name", "newest"]).default("name"),
      }),
      query,
    );
    const where: Prisma.MembershipWhereInput = {
      orgId: ctx.orgId,
      ...(input.access === "all" ? {} : { active: input.access === "active" }),
      ...(input.search
        ? {
            user: {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                { email: { contains: input.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.membership.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          role: true,
          _count: { select: { projectAccess: true } },
        },
        orderBy: [
          input.sort === "newest"
            ? { createdAt: "desc" }
            : { user: { name: "asc" } },
          { id: "asc" },
        ],
        skip: (input.page - 1) * 25,
        take: 25,
      }),
      this.db.membership.count({ where }),
    ]);
    return { rows, total, page: input.page };
  }
  @Get("roles") async roles(@Req() req: Request) {
    const ctx = await this.security.context(req, "team.manage");
    return this.db.role.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { name: "asc" },
    });
  }
  @Post("roles") async role(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.security.context(req, "organization.manage");
    const input = parse(
      z.object({
        name: z.string().min(2).max(80),
        permissions: z.array(z.enum(permissions)).max(50),
      }),
      body,
    );
    if (
      !input.permissions.every((permission) =>
        ctx.permissions.includes(permission),
      )
    )
      throw new ConflictException("Cannot grant permissions you do not hold");
    return this.db.serial(async (tx) => {
      const existing = await tx.role.findUnique({
        where: { orgId_name: { orgId: ctx.orgId, name: input.name } },
      });
      if (existing) {
        if (
          !existing.permissions.every((permission) =>
            ctx.permissions.includes(permission),
          )
        )
          throw new ConflictException("Cannot manage this role");
        const ownRole = await tx.membership.findFirst({
          where: { id: ctx.membershipId, roleId: existing.id },
          select: { id: true },
        });
        if (
          ownRole &&
          (existing.permissions.length !== new Set(input.permissions).size ||
            existing.permissions.some(
              (permission) =>
                !input.permissions.includes(
                  permission as (typeof permissions)[number],
                ),
            ))
        )
          throw new ConflictException(
            "Another administrator must change your role permissions",
          );
        if (
          existing.permissions.includes("organization.manage") &&
          !input.permissions.includes("organization.manage")
        ) {
          const remaining = await tx.membership.count({
            where: {
              orgId: ctx.orgId,
              active: true,
              roleId: { not: existing.id },
              role: { permissions: { has: "organization.manage" } },
            },
          });
          if (!remaining)
            throw new ConflictException(
              "Keep at least one active organization administrator",
            );
        }
      }
      const role = await tx.role.upsert({
        where: { orgId_name: { orgId: ctx.orgId, name: input.name } },
        create: { orgId: ctx.orgId, ...input },
        update: { permissions: input.permissions },
      });
      if (
        input.name === "ORGANIZATION_ADMIN" &&
        !input.permissions.includes("organization.manage")
      )
        throw new ConflictException(
          "Administrator role must retain organization management",
        );
      await audit(tx, ctx, "role.configured", role.id, {
        permissions: input.permissions,
      });
      return role;
    });
  }
  @Get("invitations") async invitations(
    @Req() req: Request,
    @Query() query: unknown,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const { page } = parse(
      z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }),
      query,
    );
    const where = { orgId: ctx.orgId };
    const [rows, total] = await this.db.$transaction([
      this.db.invitation.findMany({
        where,
        select: {
          id: true,
          email: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          role: { select: { name: true, permissions: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * 25,
        take: 25,
      }),
      this.db.invitation.count({ where }),
    ]);
    return {
      total,
      page,
      rows: rows.map(({ role, ...row }) => ({
        ...row,
        role: role.name,
        canManage: role.permissions.every((p) => ctx.permissions.includes(p)),
      })),
    };
  }
  private queueInvitation(
    tx: Prisma.TransactionClient,
    invitation: { id: string; orgId: string; email: string },
    raw: string,
    dedupeKey: string,
  ) {
    return tx.outbox.create({
      data: {
        orgId: invitation.orgId,
        kind: "EMAIL",
        dedupeKey,
        payload: sealIdentityMail({
          to: invitation.email,
          subject: "Invitation to Project Operations",
          text: `Accept your invitation: ${process.env.APP_ORIGIN}/#invite=${raw}`,
        }),
      },
    });
  }
  @Post("invitations") async invite(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const input = parse(z.object({ email, roleId: uuid }), body);
    return this.db.serial(async (tx) => {
      const role = await tx.role.findFirstOrThrow({
        where: { id: input.roleId, orgId: ctx.orgId },
      });
      if (!role.permissions.every((p) => ctx.permissions.includes(p)))
        throw new ConflictException("Cannot grant permissions you do not hold");
      const member = await tx.membership.findFirst({
        where: { orgId: ctx.orgId, user: { email: input.email } },
        select: { id: true },
      });
      if (member)
        throw new ConflictException(
          "This person already has a membership. Manage their access in Team.",
        );
      const pending = await tx.invitation.findFirst({
        where: {
          orgId: ctx.orgId,
          email: input.email,
          acceptedAt: null,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (pending)
        throw new ConflictException(
          "An invitation already exists. Resend or revoke it in Team.",
        );
      const raw = token();
      const invite = await tx.invitation.create({
        data: {
          orgId: ctx.orgId,
          ...input,
          tokenHash: hash(raw),
          expiresAt: new Date(
            Date.now() + Number(process.env.INVITATION_HOURS ?? 48) * 3600000,
          ),
        },
      });
      await this.queueInvitation(tx, invite, raw, `invite:${invite.id}`);
      await audit(tx, ctx, "member.invited", invite.id, {
        roleId: input.roleId,
      });
      return { id: invite.id, expiresAt: invite.expiresAt };
    });
  }
  @Post("invitations/:id/:action") async changeInvitation(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("action") action: string,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const invitationId = parse(uuid, id);
    const change = parse(z.enum(["resend", "revoke"]), action);
    if (change === "resend")
      await this.auth.limit(`invite-resend:${ctx.membershipId}`, 20);
    return this.db.serial(async (tx) => {
      const invite = await tx.invitation.findFirstOrThrow({
        where: { id: invitationId, orgId: ctx.orgId },
        include: { role: true },
      });
      if (invite.acceptedAt || invite.revokedAt)
        throw new ConflictException("Invitation is already closed");
      if (!invite.role.permissions.every((p) => ctx.permissions.includes(p)))
        throw new ConflictException(
          "Cannot manage an invitation for this role",
        );
      const key = `invite:${invite.id}`;
      await tx.outbox.deleteMany({
        where: {
          orgId: ctx.orgId,
          processedAt: null,
          OR: [{ dedupeKey: key }, { dedupeKey: { startsWith: `${key}:` } }],
        },
      });
      if (change === "revoke") {
        await tx.invitation.update({
          where: { id: invite.id },
          data: { revokedAt: new Date() },
        });
        await audit(tx, ctx, "member.invitation.revoked", invite.id);
        return { ok: true };
      }
      const raw = token();
      const tokenHash = hash(raw);
      const expiresAt = new Date(
        Date.now() + Number(process.env.INVITATION_HOURS ?? 48) * 3600000,
      );
      await tx.invitation.update({
        where: { id: invite.id },
        data: { tokenHash, expiresAt },
      });
      await this.queueInvitation(tx, invite, raw, `${key}:${tokenHash}`);
      await audit(tx, ctx, "member.invitation.resent", invite.id);
      return { id: invite.id, expiresAt };
    });
  }
}
