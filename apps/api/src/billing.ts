import {
  Controller,
  Get,
  Post,
  Body,
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
import { Operations } from "./operations";
import { z, uuid, quantity, money, day, Decimal } from "@pmt/shared";
@ApiTags("Operational invoicing and collections")
@Controller("projects/:id")
export class BillingController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
    @Inject(Operations) readonly ops: Operations,
  ) {}
  @Get("invoices") async list(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("asOf") cutoff?: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id),
      asOf = cutoff
        ? new Date(`${parse(day, cutoff)}T23:59:59.999Z`)
        : new Date();
    const invoices = await this.db.invoice.findMany({
      where: { orgId: ctx.orgId, projectId: id, createdAt: { lte: asOf } },
      include: {
        lines: { include: { boqItem: { include: { material: true } } } },
        allocations: { where: { createdAt: { lte: asOf } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return invoices.map((i) => {
      const paid = i.allocations.reduce(
        (s, a) => s.plus(a.amount.toString()),
        new Decimal(0),
      );
      const issued =
        i.issuedAt &&
        i.issuedAt <= asOf &&
        (!i.cancelledAt || i.cancelledAt > asOf);
      return {
        ...i,
        status: issued
          ? "ISSUED"
          : i.cancelledAt && i.cancelledAt <= asOf
            ? "CANCELLED"
            : "DRAFT",
        paid: paid.toFixed(2),
        outstanding: issued
          ? new Decimal(i.total.toString()).minus(paid).toFixed(2)
          : "0.00",
      };
    });
  }
  @Post("invoices") async draft(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "invoice.create", id),
      input = parse(
        z.object({
          number: z.string().trim().min(2).max(100),
          kind: z.enum(["SUPPLY", "INSTALLATION"]),
          dueDate: day,
          retentionPercent: money.default("0"),
          lines: z
            .array(z.object({ boqItemId: uuid, quantity }))
            .min(1)
            .max(100),
        }),
        body,
      );
    return this.ops.idempotent(
      ctx,
      req,
      input,
      `invoice-draft:${id}`,
      async (tx) => {
        if (new Decimal(input.retentionPercent).gt(100))
          throw new ConflictException(
            "Retention must be between 0 and 100 percent",
          );
        if (
          new Set(input.lines.map((l) => l.boqItemId)).size !==
          input.lines.length
        )
          throw new ConflictException("Duplicate invoice line");
        const org = await tx.organization.findUniqueOrThrow({
          where: { id: ctx.orgId },
        });
        let subtotal = new Decimal(0),
          tax = new Decimal(0);
        const lines = [];
        for (const line of input.lines) {
          const item = await this.ops.writable(
              tx,
              ctx,
              id,
              line.boqItemId,
              line.quantity,
            ),
            b = await this.ops.balance(tx, ctx, id, line.boqItemId);
          if (
            new Decimal(line.quantity).gt(
              input.kind === "SUPPLY"
                ? b.supplyUnbilled
                : b.installationUnbilled,
            )
          )
            throw new ConflictException(
              "Invoice quantity exceeds eligible unbilled quantity",
            );
          const rate =
            input.kind === "SUPPLY" ? item.supplyRate : item.installationRate;
          const amount = new Decimal(rate.toString())
            .mul(line.quantity)
            .toDecimalPlaces(2);
          subtotal = subtotal.plus(amount);
          tax = tax.plus(
            amount.mul(item.taxRate.toString()).div(100).toDecimalPlaces(2),
          );
          lines.push({
            boqItemId: line.boqItemId,
            quantity: line.quantity,
            rate: rate.toString(),
            taxRate: item.taxRate.toString(),
            amount: amount.toFixed(2),
          });
        }
        const retention = subtotal
            .mul(input.retentionPercent)
            .div(100)
            .toDecimalPlaces(2),
          total = subtotal.plus(tax).minus(retention);
        const invoice = await tx.invoice.create({
          data: {
            orgId: ctx.orgId,
            projectId: id,
            number: input.number,
            kind: input.kind,
            currency: org.currency,
            dueDate: new Date(input.dueDate),
            subtotal: subtotal.toFixed(2),
            tax: tax.toFixed(2),
            retention: retention.toFixed(2),
            total: total.toFixed(2),
            lines: { create: lines },
          },
          include: { lines: true },
        });
        await audit(tx, ctx, "invoice.drafted", invoice.id);
        return invoice;
      },
    );
  }
  @Post("invoices/:invoice/issue") async issue(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("invoice") invoiceId: string,
  ) {
    const ctx = await this.security.context(req, "invoice.approve", id);
    return this.ops.idempotent(
      ctx,
      req,
      {},
      `invoice-issue:${invoiceId}`,
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: {
            id: parse(uuid, invoiceId),
            orgId: ctx.orgId,
            projectId: id,
          },
          include: { lines: true },
        });
        if (!invoice) throw new NotFoundException("Invoice not found");
        if (invoice.status !== "DRAFT")
          throw new ConflictException("Only draft invoices can be issued");
        for (const line of invoice.lines) {
          const b = await this.ops.balance(tx, ctx, id, line.boqItemId);
          if (
            new Decimal(line.quantity.toString()).gt(
              invoice.kind === "SUPPLY"
                ? b.supplyUnbilled
                : b.installationUnbilled,
            )
          )
            throw new ConflictException(
              "Quantity was already invoiced or is no longer eligible",
            );
        }
        const row = await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: "ISSUED", issuedAt: new Date() },
        });
        await audit(tx, ctx, "invoice.issued", row.id, {
          total: row.total.toString(),
          currency: row.currency,
        });
        return row;
      },
    );
  }
  @Post("invoices/:invoice/cancel") async cancel(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("invoice") invoiceId: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "invoice.approve", id),
      input = parse(z.object({ reason: z.string().min(5).max(1000) }), body);
    return this.ops.idempotent(
      ctx,
      req,
      input,
      `invoice-cancel:${invoiceId}`,
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: {
            id: parse(uuid, invoiceId),
            orgId: ctx.orgId,
            projectId: id,
          },
          include: { allocations: true },
        });
        if (!invoice) throw new NotFoundException("Invoice not found");
        if (invoice.status === "CANCELLED" || invoice.allocations.length)
          throw new ConflictException(
            "Paid or already cancelled invoices cannot be cancelled",
          );
        const row = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancellationReason: input.reason,
          },
        });
        await audit(tx, ctx, "invoice.cancelled", row.id, input);
        return row;
      },
    );
  }
  @Get("payments") async payments(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.payment.findMany({
      where: { orgId: ctx.orgId, projectId: id },
      include: { allocations: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Post("payments") async payment(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "payment.create", id),
      input = parse(
        z.object({
          amount: money.refine((v) => new Decimal(v).gt(0)),
          reference: z.string().trim().min(2).max(100),
          receivedAt: day,
          allocations: z
            .array(
              z.object({
                invoiceId: uuid,
                amount: money.refine((v) => new Decimal(v).gt(0)),
              }),
            )
            .min(1)
            .max(100),
        }),
        body,
      );
    return this.ops.idempotent(ctx, req, input, `payment:${id}`, async (tx) => {
      if (new Date(input.receivedAt) > new Date())
        throw new ConflictException("Payment date cannot be in the future");
      if (
        new Set(input.allocations.map((a) => a.invoiceId)).size !==
        input.allocations.length
      )
        throw new ConflictException("Duplicate payment allocation");
      const allocated = input.allocations.reduce(
        (s, a) => s.plus(a.amount),
        new Decimal(0),
      );
      if (allocated.gt(input.amount))
        throw new ConflictException("Allocations exceed payment amount");
      for (const allocation of input.allocations) {
        const invoice = await tx.invoice.findFirst({
          where: {
            id: allocation.invoiceId,
            orgId: ctx.orgId,
            projectId: id,
            status: "ISSUED",
          },
          include: { allocations: true },
        });
        if (!invoice) throw new NotFoundException("Issued invoice not found");
        const paid = invoice.allocations.reduce(
          (s, a) => s.plus(a.amount.toString()),
          new Decimal(0),
        );
        if (paid.plus(allocation.amount).gt(invoice.total.toString()))
          throw new ConflictException(
            "Allocation exceeds outstanding invoice balance",
          );
      }
      const row = await tx.payment.create({
        data: {
          orgId: ctx.orgId,
          projectId: id,
          amount: input.amount,
          reference: input.reference,
          receivedAt: new Date(input.receivedAt),
          allocations: { create: input.allocations },
        },
        include: { allocations: true },
      });
      await tx.outbox.create({
        data: {
          orgId: ctx.orgId,
          kind: "NOTIFICATION",
          dedupeKey: `payment:${row.id}`,
          payload: {
            projectId: id,
            message: `Payment ${input.reference} received: ${input.amount}`,
          },
        },
      });
      await audit(tx, ctx, "payment.received", row.id, {
        amount: input.amount,
        reference: input.reference,
      });
      return row;
    });
  }
}
