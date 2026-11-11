import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Inject,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { Db } from "./db";
import { Security, audit, parse } from "./security";
import { Operations } from "./operations";
import { z, uuid, quantity, money, email, Decimal } from "@pmt/shared";
@ApiTags("Procurement")
@Controller()
export class ProcurementController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
    @Inject(Operations) readonly ops: Operations,
  ) {}
  @Get("suppliers") async suppliers(@Req() req: Request) {
    const ctx = await this.security.context(req, "procurement.manage");
    return this.db.supplier.findMany({
      where: { orgId: ctx.orgId },
      take: 100,
      orderBy: { name: "asc" },
    });
  }
  @Post("suppliers") async supplier(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "procurement.manage"),
      input = parse(
        z.object({
          name: z.string().min(2).max(200),
          email: email.optional(),
          taxId: z.string().max(30).optional(),
        }),
        body,
      );
    return this.db.serial(async (tx) => {
      const row = await tx.supplier.create({
        data: { orgId: ctx.orgId, ...input },
      });
      await audit(tx, ctx, "supplier.created", row.id);
      return row;
    });
  }
  @Get("projects/:id/purchase-orders") async list(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.purchaseOrder.findMany({
      where: { orgId: ctx.orgId, projectId: id },
      include: {
        supplier: true,
        lines: {
          include: {
            boqItem: { include: { material: true } },
            dispatches: { include: { receipts: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Post("projects/:id/purchase-orders") async create(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "procurement.manage", id),
      input = parse(
        z.object({
          supplierId: uuid,
          number: z.string().min(2).max(100),
          lines: z
            .array(z.object({ boqItemId: uuid, quantity, rate: money }))
            .min(1)
            .max(100),
        }),
        body,
      );
    return this.ops.idempotent(ctx, req, input, `po:${id}`, async (tx) => {
      if (
        new Set(input.lines.map((l) => l.boqItemId)).size !== input.lines.length
      )
        throw new ConflictException("Duplicate purchase line");
      if (
        !(await tx.supplier.findFirst({
          where: { id: input.supplierId, orgId: ctx.orgId, active: true },
        }))
      )
        throw new NotFoundException("Supplier not found");
      for (const line of input.lines) {
        const item = await this.ops.writable(
          tx,
          ctx,
          id,
          line.boqItemId,
          line.quantity,
        );
        const purchased = await tx.purchaseLine.findMany({
          where: {
            boqItemId: item.id,
            purchaseOrder: {
              status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] },
            },
          },
          select: { quantity: true },
        });
        const opening = await tx.openingBalance.findMany({
          where: {
            boqItemId: item.id,
            batch: {
              OR: [{ reversedAt: null }, { reversedAt: { isSet: false } }],
            },
          },
          select: { supplied: true },
        });
        if (
          purchased
            .reduce((sum, row) => sum.plus(row.quantity), new Decimal(0))
            .plus(
              opening.reduce(
                (sum, row) => sum.plus(row.supplied),
                new Decimal(0),
              ),
            )
            .plus(line.quantity)
            .gt(item.ordered.toString())
        )
          throw new ConflictException(
            "Purchase quantity exceeds remaining approved BOQ",
          );
      }
      const row = await tx.purchaseOrder.create({
        data: {
          orgId: ctx.orgId,
          projectId: id,
          supplierId: input.supplierId,
          number: input.number,
          createdBy: ctx.userId,
          lines: {
            create: input.lines.map((line) => ({ ...line, orgId: ctx.orgId })),
          },
        },
        include: { lines: true },
      });
      await audit(tx, ctx, "purchaseorder.created", row.id);
      return row;
    });
  }
  @Post("projects/:id/purchase-orders/:po/approve") async approve(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("po") po: string,
  ) {
    const ctx = await this.security.context(req, "project.approve", id);
    return this.db.serial(async (tx) => {
      const row = await tx.purchaseOrder.findFirst({
        where: { id: parse(uuid, po), orgId: ctx.orgId, projectId: id },
      });
      if (!row) throw new NotFoundException("Purchase order not found");
      if (row.status !== "DRAFT")
        throw new ConflictException("Purchase order is not a draft");
      const result = await tx.purchaseOrder.update({
        where: { id: po },
        data: {
          status: "APPROVED",
          approvedBy: ctx.userId,
          version: { increment: 1 },
        },
      });
      await audit(tx, ctx, "purchaseorder.approved", po);
      return result;
    });
  }
  @Post("projects/:id/dispatches") async dispatch(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "procurement.manage", id),
      input = parse(
        z.object({
          purchaseLineId: uuid,
          challan: z.string().min(2).max(100),
          quantity,
        }),
        body,
      );
    return this.ops.idempotent(
      ctx,
      req,
      input,
      `dispatch:${id}`,
      async (tx) => {
        const line = await tx.purchaseLine.findFirst({
          where: {
            id: input.purchaseLineId,
            orgId: ctx.orgId,
            purchaseOrder: { projectId: id, status: "APPROVED" },
          },
          include: { dispatches: true },
        });
        if (!line)
          throw new NotFoundException("Approved purchase line not found");
        const sent = line.dispatches.reduce(
          (sum, d) => sum.plus(d.quantity.toString()),
          new Decimal(0),
        );
        if (sent.plus(input.quantity).gt(line.quantity.toString()))
          throw new ConflictException("Dispatch exceeds purchase quantity");
        await this.ops.writable(tx, ctx, id, line.boqItemId, input.quantity);
        const row = await tx.dispatch.create({
          data: { orgId: ctx.orgId, ...input },
        });
        await audit(tx, ctx, "dispatch.created", row.id);
        return row;
      },
    );
  }
  @Post("projects/:id/goods-receipts") async receipt(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "stock.create", id),
      input = parse(
        z.object({
          dispatchId: uuid,
          reference: z.string().min(2).max(100),
          accepted: money,
          damaged: money.default("0"),
          rejected: money.default("0"),
          reason: z.string().max(1000).default("Accepted dispatch receipt"),
        }),
        body,
      );
    return this.ops.idempotent(
      ctx,
      req,
      input,
      `goods-receipt:${id}`,
      async (tx) => {
        const dispatch = await tx.dispatch.findFirst({
          where: {
            id: input.dispatchId,
            orgId: ctx.orgId,
            purchaseLine: {
              purchaseOrder: { projectId: id, status: "APPROVED" },
            },
          },
          include: { purchaseLine: true, receipts: true },
        });
        if (!dispatch) throw new NotFoundException("Dispatch not found");
        const total = new Decimal(input.accepted)
          .plus(input.damaged)
          .plus(input.rejected);
        if (total.lte(0))
          throw new ConflictException("Receipt must contain goods");
        await this.ops.writable(
          tx,
          ctx,
          id,
          dispatch.purchaseLine.boqItemId,
          total.toFixed(),
        );
        const received = dispatch.receipts.reduce(
          (s, r) =>
            s
              .plus(r.accepted.toString())
              .plus(r.damaged.toString())
              .plus(r.rejected.toString()),
          new Decimal(0),
        );
        if (received.plus(total).gt(dispatch.quantity.toString()))
          throw new ConflictException("Receipt exceeds dispatched quantity");
        const b = await this.ops.balance(
          tx,
          ctx,
          id,
          dispatch.purchaseLine.boqItemId,
        );
        if (new Decimal(b.supplied).plus(input.accepted).gt(b.ordered))
          throw new ConflictException("Accepted receipt exceeds approved BOQ");
        const row = await tx.goodsReceipt.create({
          data: {
            orgId: ctx.orgId,
            dispatchId: dispatch.id,
            reference: input.reference,
            accepted: input.accepted,
            damaged: input.damaged,
            rejected: input.rejected,
          },
        });
        if (new Decimal(input.accepted).gt(0))
          await tx.stockMovement.create({
            data: {
              orgId: ctx.orgId,
              projectId: id,
              boqItemId: dispatch.purchaseLine.boqItemId,
              kind: "RECEIPT",
              quantity: input.accepted,
              reference: `receipt:${row.id}`,
              reason: input.reason,
              actorId: ctx.userId,
            },
          });
        await audit(tx, ctx, "goodsreceipt.created", row.id, {
          accepted: input.accepted,
          damaged: input.damaged,
          rejected: input.rejected,
        });
        return row;
      },
    );
  }
}
