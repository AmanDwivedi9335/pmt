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
  if (!visit)
    throw new ConflictException("Punch in before uploading site media");
  return visit;
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
    return { visit: await latestVisit(this.db, ctx) };
  }

  @Post("punch-in") async punchIn(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.context(req);
    const point = parse(location, body);
    return this.db.serial(async (tx) => {
      const latest = await latestVisit(tx, ctx);
      if (latest && !latest.punchedOutAt)
        throw new ConflictException("You are already punched in");
      const visit = await tx.siteVisit.create({
        data: {
          ...owner(ctx),
          punchInLocation: point,
          punchedOutAt: null,
        },
      });
      await audit(tx, ctx, "site-visit.punched-in", visit.id);
      return { visit };
    });
  }

  @Post("punch-out") async punchOut(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const ctx = await this.context(req);
    const { visitId, ...point } = parse(
      location.extend({ visitId: uuid }),
      body,
    );
    return this.db.serial(async (tx) => {
      const latest = await latestVisit(tx, ctx);
      if (!latest || latest.id !== visitId || latest.punchedOutAt)
        throw new ConflictException("This site visit is no longer open");
      const visit = await tx.siteVisit.update({
        where: { id: visitId },
        data: { punchedOutAt: new Date(), punchOutLocation: point },
      });
      await audit(tx, ctx, "site-visit.punched-out", visit.id);
      return { visit };
    });
  }
}
