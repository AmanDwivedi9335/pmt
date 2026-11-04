import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { Db } from "./db";
import { z, uuid } from "@pmt/shared";
import type { Prisma } from "@prisma/client";
const scrypt = promisify(scryptCallback);
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export async function passwordHash(value: string) {
  const salt = token();
  const key = (await scrypt(value, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(value: string, stored: string) {
  const [, salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = (await scrypt(value, salt, 64)) as Buffer;
  return timingSafeEqual(derived, Buffer.from(key, "hex"));
}
export type Context = {
  userId: string;
  orgId: string;
  membershipId: string;
  permissions: string[];
  allProjects: boolean;
};
export const parse = <T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      message: "Validation failed",
      fields: result.error.flatten(),
    });
  return result.data;
};
export function audit(
  tx: Prisma.TransactionClient,
  ctx: Context,
  action: string,
  resourceId: string,
  detail: Prisma.InputJsonValue = {},
) {
  return tx.audit.create({
    data: { orgId: ctx.orgId, actorId: ctx.userId, action, resourceId, detail },
  });
}
@Injectable()
export class Security {
  constructor(@Inject(Db) readonly db: Db) {}
  async session(req: Request) {
    const raw = req.cookies?.pmt_session;
    if (!raw) throw new UnauthorizedException("Sign in to continue");
    const session = await this.db.session.findUnique({
      where: { tokenHash: hash(raw) },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException("Session expired");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== session.csrf
    )
      throw new ForbiddenException("CSRF token missing or invalid");
    return session;
  }
  async context(
    req: Request,
    permission: string,
    projectId?: string,
  ): Promise<Context> {
    const session = await this.session(req);
    const orgId = parse(uuid, req.headers["x-organization-id"]);
    const membership = await this.db.membership.findUnique({
      where: { orgId_userId: { orgId, userId: session.userId } },
      include: { role: true },
    });
    if (!membership?.active)
      throw new ForbiddenException("Organization access denied");
    if (!membership.role.permissions.includes(permission))
      throw new ForbiddenException(`Permission required: ${permission}`);
    const ctx = {
      userId: session.userId,
      orgId,
      membershipId: membership.id,
      permissions: membership.role.permissions,
      allProjects: membership.role.permissions.includes("organization.manage"),
    };
    if (projectId) await this.project(ctx, parse(uuid, projectId));
    return ctx;
  }
  projectFilter(ctx: Context): Prisma.ProjectWhereInput {
    return {
      orgId: ctx.orgId,
      ...(!ctx.allProjects
        ? { members: { some: { membershipId: ctx.membershipId } } }
        : {}),
    };
  }
  async project(ctx: Context, id: string) {
    const p = await this.db.project.findFirst({
      where: { id, ...this.projectFilter(ctx) },
    });
    if (!p) throw new NotFoundException("Project not found");
    return p;
  }
}
