import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { email, uuid, z } from "@pmt/shared";
import { Db } from "./db";
import { Security, audit, parse } from "./security";

const teamInput = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).default(""),
});
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

@ApiTags("Team administration")
@Controller("organizations/teams")
export class TeamsController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
  ) {}

  @Get() async list(@Req() req: Request, @Query() query: unknown) {
    const ctx = await this.security.context(req, "team.manage");
    const { page } = parse(pagination, query);
    const where = { orgId: ctx.orgId };
    const [rows, total] = await this.db.$transaction([
      this.db.team.findMany({
        where,
        include: { _count: { select: { members: true } } },
        orderBy: { normalizedName: "asc" },
        skip: (page - 1) * 25,
        take: 25,
      }),
      this.db.team.count({ where }),
    ]);
    return { rows, total, page };
  }

  @Post() async create(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.security.context(req, "team.manage");
    const input = parse(teamInput, body);
    return this.db.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          orgId: ctx.orgId,
          ...input,
          normalizedName: input.name.toLowerCase(),
        },
      });
      await audit(tx, ctx, "team.created", team.id);
      return team;
    });
  }

  @Patch(":teamId") async update(
    @Req() req: Request,
    @Param("teamId") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const teamId = parse(uuid, id);
    const input = parse(teamInput, body);
    return this.db.$transaction(async (tx) => {
      const team = await tx.team.update({
        where: { id_orgId: { id: teamId, orgId: ctx.orgId } },
        data: { ...input, normalizedName: input.name.toLowerCase() },
      });
      await audit(tx, ctx, "team.updated", team.id);
      return team;
    });
  }

  @Delete(":teamId") async remove(
    @Req() req: Request,
    @Param("teamId") id: string,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const teamId = parse(uuid, id);
    return this.db.$transaction(async (tx) => {
      await tx.team.delete({
        where: { id_orgId: { id: teamId, orgId: ctx.orgId } },
      });
      await audit(tx, ctx, "team.deleted", teamId);
      return { ok: true };
    });
  }

  @Get(":teamId/members") async members(
    @Req() req: Request,
    @Param("teamId") id: string,
    @Query() query: unknown,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const teamId = parse(uuid, id);
    const { page } = parse(pagination, query);
    const where = { orgId: ctx.orgId, teamId };
    const [, rows, total] = await this.db.$transaction([
      this.db.team.findUniqueOrThrow({
        where: { id_orgId: { id: teamId, orgId: ctx.orgId } },
        select: { id: true },
      }),
      this.db.teamMember.findMany({
        where,
        select: {
          membershipId: true,
          membership: {
            select: {
              active: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
        orderBy: [
          { membership: { user: { name: "asc" } } },
          { membershipId: "asc" },
        ],
        skip: (page - 1) * 25,
        take: 25,
      }),
      this.db.teamMember.count({ where }),
    ]);
    return { rows, total, page };
  }

  @Post(":teamId/members") async addMember(
    @Req() req: Request,
    @Param("teamId") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const teamId = parse(uuid, id);
    const input = parse(z.object({ email }), body);
    return this.db.serial(async (tx) => {
      await tx.team.findUniqueOrThrow({
        where: { id_orgId: { id: teamId, orgId: ctx.orgId } },
        select: { id: true },
      });
      const member = await tx.membership.findFirstOrThrow({
        where: { orgId: ctx.orgId, active: true, user: { email: input.email } },
        select: { id: true },
      });
      const result = await tx.teamMember.createMany({
        data: { teamId, membershipId: member.id, orgId: ctx.orgId },
        skipDuplicates: true,
      });
      if (result.count)
        await audit(tx, ctx, "team.member.added", teamId, {
          membershipId: member.id,
        });
      return { ok: true };
    });
  }

  @Delete(":teamId/members/:memberId") async removeMember(
    @Req() req: Request,
    @Param("teamId") id: string,
    @Param("memberId") memberId: string,
  ) {
    const ctx = await this.security.context(req, "team.manage");
    const teamId = parse(uuid, id);
    const membershipId = parse(uuid, memberId);
    return this.db.$transaction(async (tx) => {
      const result = await tx.teamMember.deleteMany({
        where: { teamId, membershipId, orgId: ctx.orgId },
      });
      if (result.count)
        await audit(tx, ctx, "team.member.removed", teamId, { membershipId });
      return { ok: true };
    });
  }
}
