import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { uuid, z } from "@pmt/shared";
import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { Db } from "./db";
import { audit, type Context, parse, Security } from "./security";

const location = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(),
});

export function requireSiteEngineer(ctx: Context) {
  if (ctx.roleName !== "SITE_ENGINEER")
    throw new ForbiddenException("Site attendance is for site engineers");
}

const owner = ({ orgId, membershipId }: Context) => ({ orgId, membershipId });

function latestVisit(db: Prisma.TransactionClient, ctx: Context) {
  return db.siteVisit.findFirst({
    where: owner(ctx),
    orderBy: [{ punchedInAt: "desc" }, { id: "desc" }],
  });
}

export async function requireOpenVisit(
  tx: Prisma.TransactionClient,
  ctx: Context,
  id: string,
) {
  requireSiteEngineer(ctx);
  const visit = await tx.siteVisit.findFirst({
    where: { ...owner(ctx), id, punchedOutAt: null },
  });
  if (!visit) throw new ConflictException("This site visit is no longer open");
  return visit;
}

export async function requirePunchOutProject(
  db: Prisma.TransactionClient,
  ctx: Context,
  projectId: string,
) {
  requireSiteEngineer(ctx);
  const visit = await latestVisit(db, ctx);
  if (!visit || visit.punchedOutAt || visit.punchProjectId !== projectId)
    throw new ConflictException("No open attendance visit for this project");
}

async function attachPunchPhoto(
  tx: Prisma.TransactionClient,
  ctx: Context,
  visitId: string,
  projectId: string,
  photoId: string,
  punchPhoto: "IN" | "OUT",
  punchedInAt?: Date,
) {
  const photo = await tx.document.findFirst({
    where: {
      id: photoId,
      orgId: ctx.orgId,
      projectId,
      createdBy: ctx.userId,
      punchPhoto,
      OR: [{ siteVisitId: null }, { siteVisitId: { isSet: false } }],
      ...(punchedInAt && { createdAt: { gte: punchedInAt } }),
    },
    select: { id: true },
  });
  const scan =
    photo &&
    (await tx.outbox.findUnique({
      where: { dedupeKey: `scan:${photo.id}` },
      select: { id: true },
    }));
  if (!scan)
    throw new ConflictException("Upload a photo for this punch and try again");
  await tx.document.update({
    where: { id: photoId },
    data: { siteVisitId: visitId },
  });
}

@ApiTags("Site attendance")
@Controller("workspace/site-attendance")
export class SiteVisitsController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
  ) {}

  private async context(req: Request) {
    const ctx = await this.security.context(req, "project.view");
    requireSiteEngineer(ctx);
    return ctx;
  }

  @Get() async current(@Req() req: Request) {
    const ctx = await this.context(req);
    const visit = await latestVisit(this.db, ctx);
    if (!visit?.punchProjectId) return { visit };
    const project = await this.db.project.findFirst({
      where: { orgId: ctx.orgId, id: visit.punchProjectId },
      select: { id: true, code: true, name: true },
    });
    return { visit, project };
  }

  @Post("punch-in") async punchIn(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.context(req);
    const { projectId, photoId, ...point } = parse(
      location.extend({ projectId: uuid, photoId: uuid }),
      body,
    );
    return this.db.serial(async (tx) => {
      const latest = await latestVisit(tx, ctx);
      if (latest && !latest.punchedOutAt)
        throw new ConflictException("You are already punched in");
      const project = await tx.project.findFirst({
        where: { ...this.security.projectFilter(ctx), id: projectId },
        select: { id: true, code: true, name: true },
      });
      if (!project) throw new ForbiddenException("Project access denied");
      const visit = await tx.siteVisit.create({
        data: {
          ...owner(ctx),
          punchInLocation: point,
          punchedOutAt: null,
          punchProjectId: projectId,
          projectIds: [projectId],
        },
      });
      await attachPunchPhoto(tx, ctx, visit.id, projectId, photoId, "IN");
      await audit(tx, ctx, "site-visit.punched-in", visit.id, {
        projectId,
        photoId,
      });
      return { visit, project };
    });
  }

  @Post("punch-out") async punchOut(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const ctx = await this.context(req);
    const { visitId, photoId, ...point } = parse(
      location.extend({ visitId: uuid, photoId: uuid.optional() }),
      body,
    );
    return this.db.serial(async (tx) => {
      const latest = await latestVisit(tx, ctx);
      if (!latest || latest.id !== visitId || latest.punchedOutAt)
        throw new ConflictException("This site visit is no longer open");
      if (latest.punchProjectId) {
        if (!photoId)
          throw new ConflictException("A punch-out photo is required");
        await attachPunchPhoto(
          tx,
          ctx,
          visitId,
          latest.punchProjectId,
          photoId,
          "OUT",
          latest.punchedInAt,
        );
      }
      const visit = await tx.siteVisit.update({
        where: { id: visitId },
        data: { punchedOutAt: new Date(), punchOutLocation: point },
      });
      await audit(tx, ctx, "site-visit.punched-out", visit.id, {
        projectId: latest.punchProjectId,
        photoId: latest.punchProjectId ? (photoId ?? null) : null,
      });
      return { visit };
    });
  }

  @Post("projects") async recordProject(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const ctx = await this.context(req);
    const { visitId, projectId } = parse(
      z.object({ visitId: uuid, projectId: uuid }),
      body,
    );
    return this.db.serial(async (tx) => {
      const visit = await requireOpenVisit(tx, ctx, visitId);
      const project = await tx.project.findFirst({
        where: { ...this.security.projectFilter(ctx), id: projectId },
        select: { id: true },
      });
      if (!project) throw new ForbiddenException("Project access denied");
      if (visit.projectIds.includes(projectId)) return { visit };
      const updated = await tx.siteVisit.update({
        where: { id: visit.id },
        data: { projectIds: { set: [...visit.projectIds, projectId] } },
      });
      await audit(tx, ctx, "site-visit.project-recorded", visit.id, {
        projectId,
      });
      return { visit: updated };
    });
  }
}
