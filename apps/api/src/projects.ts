import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Req,
  Inject,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { Db } from "./db";
import { Security, audit, parse } from "./security";
import {
  z,
  uuid,
  money,
  quantity,
  day,
  projectTransitions,
  email,
  Decimal,
} from "@pmt/shared";
const text = z.string().trim().min(1).max(200);
const date = day.transform((v) => new Date(v));
const projectInput = z.object({
  name: text,
  code: text,
  clientId: uuid,
  city: text,
  description: z.string().max(4000).default(""),
  address: z.string().max(500).default(""),
  state: z.string().max(100).default(""),
  country: text.default("India"),
  mapUrl: z.string().url().optional(),
  startDate: date.optional(),
  targetDate: date.optional(),
  manager: z.string().max(100).default(""),
  budget: money.default("0"),
  contractValue: money.default("0"),
  remarks: z.string().max(4000).default(""),
});
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().max(100).optional(),
  status: z
    .enum([
      "DRAFT",
      "PLANNED",
      "ACTIVE",
      "ON_HOLD",
      "DELAYED",
      "COMPLETED",
      "CLOSED",
      "CANCELLED",
    ])
    .optional(),
});
@ApiTags("Projects and work orders")
@Controller()
export class ProjectsController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
  ) {}
  @Get("clients") async clients(@Req() req: Request) {
    const ctx = await this.security.context(req, "project.view");
    return this.db.client.findMany({
      where: {
        orgId: ctx.orgId,
        OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
      },
      orderBy: { name: "asc" },
      take: 100,
    });
  }
  @Post("clients") async client(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.security.context(req, "project.create");
    const input = parse(
      z.object({
        name: text,
        email: email.optional(),
        address: z.string().max(500).optional(),
      }),
      body,
    );
    return this.db.serial(async (tx) => {
      const row = await tx.client.create({
        data: { orgId: ctx.orgId, ...input },
      });
      await audit(tx, ctx, "client.created", row.id);
      return row;
    });
  }
  @Patch("clients/:id") async editClient(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "project.edit");
    const input = parse(
      z.object({
        name: text.optional(),
        email: email.optional(),
        address: z.string().max(500).optional(),
        archived: z.boolean().optional(),
      }),
      body,
    );
    const client = await this.db.client.findFirst({
      where: { orgId: ctx.orgId, id: parse(uuid, id) },
    });
    if (!client) throw new NotFoundException("Client not found");
    return this.db.serial(async (tx) => {
      const { archived, ...fields } = input;
      const row = await tx.client.update({
        where: { id },
        data: {
          ...fields,
          ...(archived !== undefined
            ? { archivedAt: archived ? new Date() : null }
            : {}),
        },
      });
      await audit(tx, ctx, "client.updated", id);
      return row;
    });
  }
  @Get("projects") async projects(
    @Req() req: Request,
    @Query() query: unknown,
  ) {
    const ctx = await this.security.context(req, "project.view"),
      q = parse(pageQuery, query);
    const where = {
      ...this.security.projectFilter(ctx),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { code: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.project.findMany({
        where,
        include: {
          client: true,
          _count: { select: { workOrders: true, sites: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.project.count({ where }),
    ]);
    return { rows, total, page: q.page, pageSize: q.pageSize };
  }
  @Post("projects") async create(@Req() req: Request, @Body() body: unknown) {
    const ctx = await this.security.context(req, "project.create"),
      input = parse(projectInput, body);
    if (
      input.startDate &&
      input.targetDate &&
      input.startDate > input.targetDate
    )
      throw new ConflictException("Target date must follow start date");
    return this.db.serial(async (tx) => {
      const client = await tx.client.findFirst({
        where: {
          id: input.clientId,
          orgId: ctx.orgId,
          OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
        },
      });
      if (!client) throw new NotFoundException("Client not found");
      const p = await tx.project.create({
        data: {
          orgId: ctx.orgId,
          ...input,
          members: {
            create: { membershipId: ctx.membershipId, orgId: ctx.orgId },
          },
        },
      });
      await audit(tx, ctx, "project.created", p.id);
      return p;
    });
  }
  @Get("projects/:id") async detail(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    await this.security.project(ctx, id);
    return this.db.project.findUniqueOrThrow({
      where: { id },
      include: {
        client: true,
        sites: true,
        contacts: true,
        members: {
          include: {
            membership: {
              include: {
                user: { select: { id: true, name: true, email: true } },
                role: true,
              },
            },
          },
        },
        workOrders: {
          include: { items: { include: { material: true } }, revisions: true },
        },
        tasks: true,
        documents: true,
      },
    });
  }
  @Patch("projects/:id") async edit(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "project.edit", id),
      input = parse(
        projectInput.partial().extend({ version: z.number().int().positive() }),
        body,
      );
    return this.db.serial(async (tx) => {
      if (
        input.clientId &&
        !(await tx.client.findFirst({
          where: { id: input.clientId, orgId: ctx.orgId },
        }))
      )
        throw new NotFoundException("Client not found");
      const p = await tx.project.findFirstOrThrow({
        where: { id, orgId: ctx.orgId },
      });
      if (["CLOSED", "CANCELLED"].includes(p.status))
        throw new ConflictException("Historical projects are locked");
      const { version, ...fields } = input;
      if (
        (fields.startDate || p.startDate) &&
        (fields.targetDate || p.targetDate) &&
        (fields.startDate || p.startDate)! >
          (fields.targetDate || p.targetDate)!
      )
        throw new ConflictException("Invalid project date range");
      const updated = await tx.project.updateMany({
        where: { id, orgId: ctx.orgId, version },
        data: { ...fields, version: { increment: 1 } },
      });
      if (!updated.count)
        throw new ConflictException("Project changed. Reload before saving.");
      await audit(tx, ctx, "project.updated", id);
      return tx.project.findUniqueOrThrow({ where: { id } });
    });
  }
  @Post("projects/:id/status") async status(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "project.approve", id),
      input = parse(
        z.object({
          status: z.enum([
            "DRAFT",
            "PLANNED",
            "ACTIVE",
            "ON_HOLD",
            "DELAYED",
            "COMPLETED",
            "CLOSED",
            "CANCELLED",
          ]),
          version: z.number().int().positive(),
          reason: z.string().min(3).max(1000),
        }),
        body,
      );
    return this.db.serial(async (tx) => {
      const p = await tx.project.findFirstOrThrow({
        where: { id, orgId: ctx.orgId },
      });
      if (!projectTransitions[p.status].includes(input.status))
        throw new ConflictException(
          `Cannot transition ${p.status} to ${input.status}`,
        );
      if (input.status === "COMPLETED") {
        const pending = await tx.installation.count({
          where: {
            projectId: id,
            status: { in: ["DRAFT", "SUBMITTED", "VERIFIED"] },
          },
        });
        if (pending)
          throw new ConflictException(
            "Resolve pending installations before completing the project",
          );
      }
      const updated = await tx.project.updateMany({
        where: { id, version: input.version },
        data: {
          status: input.status,
          version: { increment: 1 },
          ...(input.status === "COMPLETED" ? { actualDate: new Date() } : {}),
        },
      });
      if (!updated.count)
        throw new ConflictException("Project changed. Reload.");
      await audit(tx, ctx, "project.status.changed", id, {
        from: p.status,
        to: input.status,
        reason: input.reason,
      });
      return tx.project.findUniqueOrThrow({ where: { id } });
    });
  }
  @Post("projects/:id/members") async member(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "team.manage", id),
      input = parse(
        z.object({ membershipId: uuid, remove: z.boolean().default(false) }),
        body,
      );
    return this.db.serial(async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: input.membershipId, orgId: ctx.orgId, active: true },
      });
      if (!member) throw new NotFoundException("Member not found");
      if (input.remove)
        await tx.projectMember.deleteMany({
          where: { projectId: id, membershipId: member.id },
        });
      else
        await tx.projectMember.upsert({
          where: {
            projectId_membershipId: { projectId: id, membershipId: member.id },
          },
          create: { orgId: ctx.orgId, projectId: id, membershipId: member.id },
          update: {},
        });
      await audit(tx, ctx, "project.member.changed", id, input);
      return { ok: true };
    });
  }
  @Post("projects/:id/sites") async site(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "project.edit", id),
      input = parse(
        z.object({ name: text, address: z.string().max(500).default("") }),
        body,
      );
    return this.db.serial(async (tx) => {
      const row = await tx.site.create({
        data: { orgId: ctx.orgId, projectId: id, ...input },
      });
      await audit(tx, ctx, "site.created", row.id);
      return row;
    });
  }
  @Post("projects/:id/contacts") async contact(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "project.edit", id),
      input = parse(
        z.object({
          name: text,
          role: text,
          email: email.optional(),
          phone: z.string().max(30).optional(),
        }),
        body,
      );
    return this.db.serial(async (tx) => {
      const row = await tx.contact.create({
        data: { orgId: ctx.orgId, projectId: id, ...input },
      });
      await audit(tx, ctx, "contact.created", row.id);
      return row;
    });
  }
  @Get("materials") async materials(@Req() req: Request) {
    const ctx = await this.security.context(req, "project.view");
    return this.db.material.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { name: "asc" },
      take: 100,
    });
  }
  @Post("materials") async material(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "material.manage"),
      input = parse(
        z.object({
          sku: text,
          name: text,
          category: text.default("General"),
          description: z.string().max(4000).default(""),
          uom: text.default("Nos"),
          precision: z.number().int().min(0).max(4).default(0),
          standardRate: money.default("0"),
          taxRate: z
            .string()
            .refine(
              (v) => /^\d+(\.\d{1,2})?$/.test(v) && new Decimal(v).lte(100),
            )
            .default("0"),
        }),
        body,
      );
    return this.db.serial(async (tx) => {
      const row = await tx.material.create({
        data: { orgId: ctx.orgId, ...input },
      });
      await audit(tx, ctx, "material.created", row.id);
      return row;
    });
  }
  @Post("projects/:id/work-orders") async workOrder(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "workorder.manage", id),
      input = parse(z.object({ number: text }), body);
    return this.db.serial(async (tx) => {
      const row = await tx.workOrder.create({
        data: { orgId: ctx.orgId, projectId: id, ...input },
      });
      await audit(tx, ctx, "workorder.created", row.id);
      return row;
    });
  }
  @Post("projects/:id/work-orders/:wo/items") async item(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("wo") wo: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "workorder.manage", id),
      input = parse(
        z.object({
          materialId: uuid,
          ordered: quantity,
          supplyRate: money,
          installationRate: money,
          taxRate: money.default("0"),
          reason: z.string().min(3).max(1000),
        }),
        body,
      );
    return this.db.serial(async (tx) => {
      const order = await tx.workOrder.findFirst({
          where: { id: parse(uuid, wo), projectId: id, orgId: ctx.orgId },
          include: { items: true },
        }),
        material = await tx.material.findFirst({
          where: { id: input.materialId, orgId: ctx.orgId, active: true },
        });
      if (!order || !material)
        throw new NotFoundException("Work order or material not found");
      if (order.approvedAt)
        throw new ConflictException(
          "Approved work orders require a controlled variation",
        );
      if (
        new Decimal(input.ordered).decimalPlaces() > material.precision ||
        new Decimal(input.taxRate).gt(100)
      )
        throw new ConflictException("Invalid material precision or tax rate");
      await tx.workOrderRevision.create({
        data: {
          workOrderId: wo,
          version: order.version,
          snapshot: JSON.parse(JSON.stringify(order)),
          reason: input.reason,
        },
      });
      const { reason, ...fields } = input;
      const row = await tx.boqItem.create({
        data: { orgId: ctx.orgId, workOrderId: wo, ...fields },
      });
      await tx.workOrder.update({
        where: { id: wo },
        data: { version: { increment: 1 } },
      });
      await audit(tx, ctx, "boq.created", row.id, { reason });
      return row;
    });
  }
  @Post("projects/:id/work-orders/:wo/approve") async approve(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("wo") wo: string,
  ) {
    const ctx = await this.security.context(req, "project.approve", id);
    return this.db.serial(async (tx) => {
      const order = await tx.workOrder.findFirst({
        where: { id: parse(uuid, wo), projectId: id, orgId: ctx.orgId },
        include: { items: true },
      });
      if (!order) throw new NotFoundException("Work order not found");
      if (!order.items.length || order.approvedAt)
        throw new ConflictException("Work order is empty or already approved");
      const row = await tx.workOrder.update({
        where: { id: wo },
        data: { approvedAt: new Date(), version: { increment: 1 } },
      });
      await audit(tx, ctx, "workorder.approved", wo);
      return row;
    });
  }
}
