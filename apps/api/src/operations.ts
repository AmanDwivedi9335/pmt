import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { Prisma } from "@prisma/client";
import { Db } from "./db";
import { Security, audit, parse, hash, type Context } from "./security";
import { z, uuid, quantity, day, balances, Decimal } from "@pmt/shared";
export type Tx = Prisma.TransactionClient;
@Injectable()
export class Operations {
  constructor(@Inject(Db) readonly db: Db) {}
  async idempotent(
    ctx: Context,
    req: Request,
    body: unknown,
    operation: string,
    fn: (tx: Tx) => Promise<any>,
  ) {
    const key = parse(
      z.string().min(16).max(128),
      req.headers["idempotency-key"],
    );
    const digest = hash(JSON.stringify({ operation, body }));
    return this.db.serial(async (tx) => {
      const existing = await tx.idempotency.findUnique({
        where: { orgId_key: { orgId: ctx.orgId, key } },
      });
      if (existing) {
        if (existing.hash !== digest)
          throw new ConflictException(
            "Idempotency key was used for a different request",
          );
        return existing.result;
      }
      const result = await fn(tx);
      const json = JSON.parse(JSON.stringify(result));
      await tx.idempotency.create({
        data: { orgId: ctx.orgId, key, hash: digest, result: json },
      });
      return json;
    });
  }
  async item(tx: Tx, ctx: Context, projectId: string, id: string) {
    const row = await tx.boqItem.findFirst({
      where: { id, orgId: ctx.orgId, workOrder: { projectId } },
      include: { material: true, workOrder: { include: { project: true } } },
    });
    if (!row) throw new NotFoundException("BOQ item not found");
    return row;
  }
  async writable(
    tx: Tx,
    ctx: Context,
    projectId: string,
    id: string,
    q: string,
  ) {
    const item = await this.item(tx, ctx, projectId, id);
    if (!item.workOrder.approvedAt)
      throw new ConflictException("Work order must be approved");
    if (!["ACTIVE", "DELAYED"].includes(item.workOrder.project.status))
      throw new ConflictException("Project must be active");
    if (new Decimal(q).decimalPlaces() > item.material.precision)
      throw new ConflictException(
        "Quantity exceeds configured material precision",
      );
    return item;
  }
  async balance(
    tx: Tx,
    ctx: Context,
    projectId: string,
    id: string,
    asOf = new Date(),
  ) {
    const item = await this.item(tx, ctx, projectId, id);
    const openings = await tx.openingBalance.findMany({
      where: {
        boqItemId: id,
        orgId: ctx.orgId,
        batch: {
          asOf: { lte: asOf },
          OR: [{ reversedAt: null }, { reversedAt: { gt: asOf } }],
        },
      },
    });
    const movements = await tx.stockMovement.findMany({
      where: { orgId: ctx.orgId, boqItemId: id, effectiveAt: { lte: asOf } },
    });
    const allocations = await tx.invoiceLine.findMany({
      where: {
        orgId: ctx.orgId,
        boqItemId: id,
        invoice: {
          issuedAt: { lte: asOf },
          OR: [{ cancelledAt: null }, { cancelledAt: { gt: asOf } }],
        },
      },
      include: { invoice: { select: { kind: true } } },
    });
    let supplied = new Decimal(0),
      installed = new Decimal(0),
      supplyBilled = new Decimal(0),
      installationBilled = new Decimal(0);
    for (const o of openings) {
      supplied = supplied.plus(o.supplied.toString());
      installed = installed.plus(o.installed.toString());
      supplyBilled = supplyBilled.plus(o.supplyBilled.toString());
      installationBilled = installationBilled.plus(
        o.installationBilled.toString(),
      );
    }
    for (const m of movements) {
      if (m.reference.startsWith("installation:"))
        installed = installed.minus(m.quantity.toString());
      else supplied = supplied.plus(m.quantity.toString());
    }
    for (const a of allocations) {
      if (a.invoice.kind === "SUPPLY")
        supplyBilled = supplyBilled.plus(a.quantity.toString());
      else installationBilled = installationBilled.plus(a.quantity.toString());
    }
    return {
      id: item.id,
      material: item.material.name,
      sku: item.material.sku,
      uom: item.material.uom,
      supplyRate: item.supplyRate.toString(),
      installationRate: item.installationRate.toString(),
      ...balances(
        item.ordered.toString(),
        supplied,
        installed,
        supplyBilled,
        installationBilled,
      ),
      supplyBilled: supplyBilled.toFixed(),
      installationBilled: installationBilled.toFixed(),
    };
  }
}
@ApiTags("Inventory and installation")
@Controller("projects/:id")
export class OperationsController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
    @Inject(Operations) readonly ops: Operations,
  ) {}
  @Get("balances") async balances(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("asOf") cutoff?: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    const asOf = cutoff
      ? new Date(`${parse(day, cutoff)}T23:59:59.999Z`)
      : new Date();
    return this.db.$transaction(
      async (tx) => {
        const items = await tx.boqItem.findMany({
          where: { orgId: ctx.orgId, workOrder: { projectId: id } },
        });
        return Promise.all(
          items.map((item) => this.ops.balance(tx, ctx, id, item.id, asOf)),
        );
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  @Get("movements") async ledger(@Req() req: Request, @Param("id") id: string) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.stockMovement.findMany({
      where: { orgId: ctx.orgId, projectId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { boqItem: { include: { material: true } } },
    });
  }
  @Post("receipts") async receipt(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "stock.create", id),
      input = parse(
        z.object({
          boqItemId: uuid,
          quantity,
          reference: z.string().trim().min(2).max(100),
          notes: z.string().max(1000).default(""),
        }),
        body,
      );
    return this.ops.idempotent(ctx, req, input, `receipt:${id}`, async (tx) => {
      const item = await this.ops.writable(
          tx,
          ctx,
          id,
          input.boqItemId,
          input.quantity,
        ),
        b = await this.ops.balance(tx, ctx, id, item.id);
      if (new Decimal(b.supplied).plus(input.quantity).gt(b.ordered))
        throw new ConflictException(
          "Receipt exceeds approved ordered quantity",
        );
      const reference = `receipt:${input.reference}`;
      if (
        await tx.stockMovement.findFirst({
          where: {
            orgId: ctx.orgId,
            projectId: id,
            boqItemId: item.id,
            reference,
          },
        })
      )
        throw new ConflictException(
          "This delivery reference already exists for the material",
        );
      const movement = await tx.stockMovement.create({
        data: {
          orgId: ctx.orgId,
          projectId: id,
          boqItemId: item.id,
          kind: "RECEIPT",
          quantity: input.quantity,
          reference,
          reason: input.notes || "Accepted goods receipt",
          actorId: ctx.userId,
        },
      });
      await audit(tx, ctx, "stock.received", movement.id, {
        quantity: input.quantity,
        reference: input.reference,
      });
      return movement;
    });
  }
  @Post("returns") async stockReturn(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "stock.reverse", id),
      input = parse(
        z.object({
          boqItemId: uuid,
          quantity,
          reference: z.string().min(2).max(100),
          reason: z.string().min(5).max(1000),
        }),
        body,
      );
    return this.ops.idempotent(ctx, req, input, `return:${id}`, async (tx) => {
      await this.ops.writable(tx, ctx, id, input.boqItemId, input.quantity);
      const b = await this.ops.balance(tx, ctx, id, input.boqItemId);
      if (
        new Decimal(input.quantity).gt(b.available) ||
        new Decimal(b.supplied).minus(input.quantity).lt(b.supplyBilled)
      )
        throw new ConflictException("Return exceeds available unbilled stock");
      const reference = `return:${input.reference}`;
      if (
        await tx.stockMovement.findFirst({
          where: {
            orgId: ctx.orgId,
            projectId: id,
            boqItemId: input.boqItemId,
            reference,
          },
        })
      )
        throw new ConflictException("Return reference already exists");
      const m = await tx.stockMovement.create({
        data: {
          orgId: ctx.orgId,
          projectId: id,
          boqItemId: input.boqItemId,
          kind: "RETURN",
          quantity: new Decimal(input.quantity).negated().toFixed(),
          reference,
          reason: input.reason,
          actorId: ctx.userId,
        },
      });
      await audit(tx, ctx, "stock.returned", m.id, input);
      return m;
    });
  }
  @Get("installations") async installations(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.installation.findMany({
      where: { orgId: ctx.orgId, projectId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { boqItem: { include: { material: true } } },
    });
  }
  @Post("installations") async create(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "installation.create", id),
      input = parse(
        z.object({
          boqItemId: uuid,
          quantity,
          area: z.string().trim().min(1).max(200),
          reportDate: day,
          notes: z.string().max(4000).default(""),
        }),
        body,
      );
    return this.ops.idempotent(
      ctx,
      req,
      input,
      `installation:${id}`,
      async (tx) => {
        await this.ops.writable(tx, ctx, id, input.boqItemId, input.quantity);
        if (new Date(input.reportDate) > new Date())
          throw new ConflictException("Progress date cannot be in the future");
        const row = await tx.installation.create({
          data: {
            orgId: ctx.orgId,
            projectId: id,
            ...input,
            reportDate: new Date(input.reportDate),
            createdBy: ctx.userId,
          },
        });
        await audit(tx, ctx, "installation.created", row.id);
        return row;
      },
    );
  }
  @Post("installations/:entry/transition") async transition(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("entry") entry: string,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({
        status: z.enum([
          "SUBMITTED",
          "VERIFIED",
          "APPROVED",
          "REJECTED",
          "REVERSED",
        ]),
        version: z.number().int().positive(),
        reason: z.string().max(1000).optional(),
      }),
      body,
    );
    const perm =
      input.status === "SUBMITTED"
        ? "installation.create"
        : input.status === "VERIFIED"
          ? "installation.verify"
          : "installation.approve";
    const ctx = await this.security.context(req, perm, id);
    return this.ops.idempotent(
      ctx,
      req,
      input,
      `installation-transition:${entry}`,
      async (tx) => {
        const row = await tx.installation.findFirst({
          where: { id: parse(uuid, entry), orgId: ctx.orgId, projectId: id },
        });
        if (!row) throw new NotFoundException("Installation not found");
        if (row.version !== input.version)
          throw new ConflictException("Installation changed. Reload.");
        const transitions: Record<string, string[]> = {
          DRAFT: ["SUBMITTED"],
          SUBMITTED: ["VERIFIED", "REJECTED"],
          VERIFIED: ["APPROVED", "REJECTED"],
          APPROVED: ["REVERSED"],
          REJECTED: [],
          REVERSED: [],
        };
        if (!transitions[row.status].includes(input.status))
          throw new ConflictException(
            `Cannot transition ${row.status} to ${input.status}`,
          );
        if (
          ["REJECTED", "REVERSED"].includes(input.status) &&
          (!input.reason || input.reason.trim().length < 5)
        )
          throw new ConflictException(
            "A reason of at least five characters is required",
          );
        if (
          input.status === "SUBMITTED" &&
          row.createdBy !== ctx.userId &&
          !ctx.permissions.includes("installation.approve")
        )
          throw new ConflictException("Only the author can submit this report");
        if (
          ["VERIFIED", "APPROVED"].includes(input.status) &&
          row.createdBy === ctx.userId
        )
          throw new ConflictException(
            "An independent reviewer must verify and approve this report",
          );
        if (input.status === "APPROVED" || input.status === "REVERSED") {
          await this.ops.writable(
            tx,
            ctx,
            id,
            row.boqItemId,
            row.quantity.toString(),
          );
          const b = await this.ops.balance(tx, ctx, id, row.boqItemId);
          if (input.status === "APPROVED") {
            if (new Decimal(row.quantity.toString()).gt(b.available))
              throw new ConflictException("Insufficient available stock");
            if (
              new Decimal(b.installed)
                .plus(row.quantity.toString())
                .gt(b.ordered)
            )
              throw new ConflictException(
                "Installation exceeds approved BOQ quantity",
              );
          } else if (
            new Decimal(b.installed)
              .minus(row.quantity.toString())
              .lt(b.installationBilled)
          )
            throw new ConflictException(
              "Reverse allocated invoices before reversing this installation",
            );
          await tx.stockMovement.create({
            data: {
              orgId: ctx.orgId,
              projectId: id,
              boqItemId: row.boqItemId,
              kind: input.status === "APPROVED" ? "CONSUMPTION" : "REVERSAL",
              quantity: new Decimal(row.quantity.toString())
                .mul(input.status === "APPROVED" ? -1 : 1)
                .toFixed(),
              reference: `installation:${row.id}`,
              reason: input.reason || "Approved installation",
              actorId: ctx.userId,
            },
          });
        }
        const updated = await tx.installation.update({
          where: { id: row.id },
          data: {
            status: input.status,
            version: { increment: 1 },
            reason: input.reason,
            ...(input.status === "APPROVED"
              ? { approvedAt: new Date(), approvedBy: ctx.userId }
              : {}),
          },
        });
        await audit(
          tx,
          ctx,
          `installation.${input.status.toLowerCase()}`,
          row.id,
          { reason: input.reason || "" },
        );
        return updated;
      },
    );
  }
}
