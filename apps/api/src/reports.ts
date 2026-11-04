import {
  Controller,
  Get,
  Query,
  Param,
  Req,
  Res,
  Inject,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { Db } from "./db";
import { Security, parse, audit } from "./security";
import { Operations } from "./operations";
import { z, uuid, day, Decimal } from "@pmt/shared";
import { renderProjectReport } from "./pdf-report";
@ApiTags("Dashboard and reports")
@Controller()
export class ReportsController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
    @Inject(Operations) readonly ops: Operations,
  ) {}
  @Get("dashboard") async dashboard(
    @Req() req: Request,
    @Query() query: unknown,
  ) {
    const ctx = await this.security.context(req, "project.view");
    const q = parse(
      z.object({
        projectId: uuid.optional(),
        clientId: uuid.optional(),
        city: z.string().max(100).optional(),
        manager: z.string().max(100).optional(),
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
      }),
      query,
    );
    return this.db.$transaction(
      async (tx) => {
        const projects = await tx.project.findMany({
            where: {
              ...this.security.projectFilter(ctx),
              ...(q.projectId ? { id: q.projectId } : {}),
              ...(q.clientId ? { clientId: q.clientId } : {}),
              ...(q.city ? { city: q.city } : {}),
              ...(q.manager ? { manager: q.manager } : {}),
              ...(q.status ? { status: q.status } : {}),
            },
            include: { client: true },
          }),
          ids = projects.map((p) => p.id);
        const where = { orgId: ctx.orgId, projectId: { in: ids } };
        const now = new Date();
        const today = new Date(
          `${now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00Z`,
        );
        const projectBilling = new Map<
          string,
          { outstanding: Decimal; overdueInvoices: number }
        >();
        const invoices = await tx.invoice.findMany({
          where: { ...where, status: "ISSUED" },
          include: { allocations: true },
        });
        let invoiced = new Decimal(0),
          outstanding = new Decimal(0),
          overdue = new Decimal(0),
          orderValue = new Decimal(0),
          suppliedValue = new Decimal(0),
          installedValue = new Decimal(0),
          installationOrderValue = new Decimal(0),
          unbilled = new Decimal(0);
        for (const i of invoices) {
          const paid = i.allocations.reduce(
              (s, a) => s.plus(a.amount.toString()),
              new Decimal(0),
            ),
            balance = new Decimal(i.total.toString()).minus(paid);
          invoiced = invoiced.plus(i.total.toString());
          outstanding = outstanding.plus(balance);
          const billing = projectBilling.get(i.projectId) ?? {
            outstanding: new Decimal(0),
            overdueInvoices: 0,
          };
          billing.outstanding = billing.outstanding.plus(balance);
          if (i.dueDate < today && balance.gt(0)) {
            overdue = overdue.plus(balance);
            billing.overdueInvoices += 1;
          }
          projectBilling.set(i.projectId, billing);
        }
        const items = await tx.boqItem.findMany({
          where: {
            orgId: ctx.orgId,
            workOrder: { projectId: { in: ids }, approvedAt: { not: null } },
          },
          include: { workOrder: true },
        });
        const materials = [];
        const projectProgress = new Map<
          string,
          {
            supplyOrder: Decimal;
            supplied: Decimal;
            installationOrder: Decimal;
            installed: Decimal;
          }
        >();
        const percent = (done: Decimal, total: Decimal) =>
          total.gt(0) ? done.div(total).mul(100).toFixed(1) : null;
        for (const item of items) {
          const projectId = item.workOrder.projectId;
          const b = await this.ops.balance(tx, ctx, projectId, item.id);
          const supplyOrder = new Decimal(b.ordered).mul(b.supplyRate);
          const supplied = new Decimal(b.supplied).mul(b.supplyRate);
          const installationOrder = new Decimal(b.ordered).mul(
            b.installationRate,
          );
          const installed = new Decimal(b.installed).mul(b.installationRate);
          orderValue = orderValue.plus(supplyOrder);
          suppliedValue = suppliedValue.plus(supplied);
          installationOrderValue =
            installationOrderValue.plus(installationOrder);
          installedValue = installedValue.plus(installed);
          const progress = projectProgress.get(projectId);
          projectProgress.set(projectId, {
            supplyOrder: progress
              ? progress.supplyOrder.plus(supplyOrder)
              : supplyOrder,
            supplied: progress ? progress.supplied.plus(supplied) : supplied,
            installationOrder: progress
              ? progress.installationOrder.plus(installationOrder)
              : installationOrder,
            installed: progress
              ? progress.installed.plus(installed)
              : installed,
          });
          unbilled = unbilled
            .plus(new Decimal(b.supplyUnbilled).mul(b.supplyRate))
            .plus(new Decimal(b.installationUnbilled).mul(b.installationRate));
          materials.push({ ...b, projectId: item.workOrder.projectId });
        }
        const [approvals, tasks] = await Promise.all([
          tx.installation.groupBy({
            by: ["projectId"],
            where: { ...where, status: { in: ["SUBMITTED", "VERIFIED"] } },
            _count: { _all: true },
          }),
          tx.task.findMany({
            where: { ...where, status: { not: "DONE" } },
            select: {
              id: true,
              projectId: true,
              title: true,
              dueDate: true,
              priority: true,
              status: true,
            },
            orderBy: [{ dueDate: "asc" }, { id: "asc" }],
          }),
        ]);
        const approvalsByProject = new Map(
          approvals.map((approval) => [
            approval.projectId,
            approval._count._all,
          ]),
        );
        const tasksByProject = new Map<string, typeof tasks>();
        for (const task of tasks) {
          const projectTasks = tasksByProject.get(task.projectId) ?? [];
          projectTasks.push(task);
          tasksByProject.set(task.projectId, projectTasks);
        }
        const projectCards = projects.map((project) => {
          const target = ["CLOSED", "COMPLETED", "CANCELLED"].includes(
            project.status,
          )
            ? null
            : project.targetDate;
          const openTasks = tasksByProject.get(project.id) ?? [];
          const billing = projectBilling.get(project.id);
          const progress = projectProgress.get(project.id);
          return {
            ...project,
            supplyProgress: progress
              ? percent(progress.supplied, progress.supplyOrder)
              : null,
            installationProgress: progress
              ? percent(progress.installed, progress.installationOrder)
              : null,
            attention: {
              delayed:
                project.status === "DELAYED" ||
                Boolean(target && target < today),
              pendingApprovals: approvalsByProject.get(project.id) ?? 0,
              overdueInvoices: billing?.overdueInvoices ?? 0,
              overdueTasks: openTasks.filter(
                (task) => task.dueDate && task.dueDate < today,
              ),
              upcomingTasks: openTasks.filter(
                (task) => task.dueDate && task.dueDate >= today,
              ),
              unscheduledTasks: openTasks.filter((task) => !task.dueDate),
              upcomingTarget: target && target >= today ? target : null,
              outstanding: billing?.outstanding.toFixed(2) ?? "0.00",
            },
          };
        });
        return {
          currency: (
            await tx.organization.findUniqueOrThrow({
              where: { id: ctx.orgId },
            })
          ).currency,
          totalProjects: projects.length,
          activeProjects: projects.filter((p) => p.status === "ACTIVE").length,
          delayedProjects: projectCards.filter((p) => p.attention.delayed)
            .length,
          orderValue: orderValue.toFixed(2),
          invoiced: invoiced.toFixed(2),
          outstanding: outstanding.toFixed(2),
          overdue: overdue.toFixed(2),
          unbilled: unbilled.toFixed(2),
          supplyProgress: percent(suppliedValue, orderValue),
          installationProgress: percent(installedValue, installationOrderValue),
          pendingApprovals: approvals.reduce(
            (total, approval) => total + approval._count._all,
            0,
          ),
          overdueTasks: projectCards.reduce(
            (total, p) => total + p.attention.overdueTasks.length,
            0,
          ),
          today,
          projects: projectCards,
          materials,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 30000 },
    );
  }
  @Get("projects/:id/export") async export(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("asOf") cutoff: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.security.context(req, "report.export", id),
      project = await this.security.project(ctx, id),
      asOf = cutoff
        ? new Date(`${parse(day, cutoff)}T23:59:59.999Z`)
        : new Date();
    const rows = await this.db.$transaction(
      async (tx) => {
        const items = await tx.boqItem.findMany({
          where: { orgId: ctx.orgId, workOrder: { projectId: id } },
        });
        return Promise.all(
          items.map((i) => this.ops.balance(tx, ctx, id, i.id, asOf)),
        );
      },
      { isolationLevel: "RepeatableRead" },
    );
    const wb = new ExcelJS.Workbook();
    const meta = wb.addWorksheet("Project");
    meta.addRows([
      ["Project", project.name],
      ["Code", project.code],
      ["Location", project.city],
      ["As of", asOf.toISOString()],
      [
        "Note",
        "Historical opening balances are separate from operational transactions. Contract quantities reflect the current approved baseline.",
      ],
    ]);
    meta.columns = [{ width: 22 }, { width: 100 }];
    const progress = wb.addWorksheet("Material progress");
    progress.columns = [
      { header: "Material", key: "material", width: 32 },
      { header: "UOM", key: "uom", width: 12 },
      ...[
        "ordered",
        "supplied",
        "installed",
        "pendingSupply",
        "pendingInstallation",
        "available",
        "supplyBilled",
        "supplyUnbilled",
        "installationBilled",
        "installationUnbilled",
      ].map((key) => ({ header: key, key, width: 23 })),
    ];
    progress.addRows(rows);
    progress.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    progress.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF244E3D" },
    };
    progress.views = [{ state: "frozen", ySplit: 1 }];
    const invoiceSheet = wb.addWorksheet("Billing");
    invoiceSheet.columns = [
      { header: "Invoice", key: "number", width: 20 },
      { header: "Kind", key: "kind", width: 16 },
      { header: "Currency", key: "currency", width: 12 },
      { header: "Invoiced", key: "total", width: 18 },
      { header: "Paid", key: "paid", width: 18 },
      { header: "Outstanding", key: "outstanding", width: 18 },
    ];
    const invoices = await this.db.invoice.findMany({
      where: {
        orgId: ctx.orgId,
        projectId: id,
        issuedAt: { lte: asOf },
        OR: [{ cancelledAt: null }, { cancelledAt: { gt: asOf } }],
      },
      include: { allocations: { where: { createdAt: { lte: asOf } } } },
    });
    invoiceSheet.addRows(
      invoices.map((i) => {
        const paid = i.allocations.reduce(
          (s, a) => s.plus(a.amount.toString()),
          new Decimal(0),
        );
        return {
          number: i.number,
          kind: i.kind,
          currency: i.currency,
          total: i.total.toString(),
          paid: paid.toFixed(2),
          outstanding: new Decimal(i.total.toString()).minus(paid).toFixed(2),
        };
      }),
    );
    await this.db.$transaction((tx) =>
      audit(tx, ctx, "report.exported", id, { asOf: asOf.toISOString() }),
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="project-${project.code.replace(/[^a-z0-9-]/gi, "_")}.xlsx"`,
    );
    await wb.xlsx.write(res);
    res.end();
  }
  @Get("projects/:id/export.pdf") async pdf(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("asOf") cutoff: string | undefined,
    @Res() res: Response,
  ) {
    const ctx = await this.security.context(req, "report.export", id),
      project = await this.security.project(ctx, id),
      asOf = cutoff
        ? new Date(`${parse(day, cutoff)}T23:59:59.999Z`)
        : new Date();
    const report = await this.db.$transaction(
      async (tx) => {
        const items = await tx.boqItem.findMany({
            where: { orgId: ctx.orgId, workOrder: { projectId: id } },
          }),
          rows = await Promise.all(
            items.map((i) => this.ops.balance(tx, ctx, id, i.id, asOf)),
          ),
          invoices = await tx.invoice.findMany({
            where: {
              orgId: ctx.orgId,
              projectId: id,
              issuedAt: { lte: asOf },
              OR: [{ cancelledAt: null }, { cancelledAt: { gt: asOf } }],
            },
            include: { allocations: { where: { createdAt: { lte: asOf } } } },
          });
        return {
          rows,
          invoices: invoices.map((i) => {
            const paid = i.allocations.reduce(
              (s, a) => s.plus(a.amount.toString()),
              new Decimal(0),
            );
            return {
              number: i.number,
              kind: i.kind,
              total: i.total.toString(),
              paid: paid.toFixed(2),
              outstanding: new Decimal(i.total.toString())
                .minus(paid)
                .toFixed(2),
            };
          }),
          currency: (
            await tx.organization.findUniqueOrThrow({
              where: { id: ctx.orgId },
            })
          ).currency,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
    const buffer = await renderProjectReport({ project, asOf, ...report });
    await this.db.$transaction((tx) =>
      audit(tx, ctx, "report.pdf.exported", id, { asOf: asOf.toISOString() }),
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="project-${project.code.replace(/[^a-z0-9-]/gi, "_")}.pdf"`,
    );
    res.send(buffer);
  }
}
