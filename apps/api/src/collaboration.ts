import {
  Body,
  Controller,
  Get,
  Query,
  ForbiddenException,
  Post,
  Patch,
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
import {
  attachmentSizeLimit,
  attachmentTypes,
  day,
  documentTypes,
  siteMediaTypes,
  uuid,
  z,
} from "@pmt/shared";
import { requireOpenVisit } from "./site-visits";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
export function storage(publicEndpoint = false) {
  return new S3Client({
    endpoint: publicEndpoint
      ? process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT
      : process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: true,
    // Browser uploads are signed before their bytes are available.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: process.env.S3_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY || "",
        }
      : undefined,
  });
}
const taskInput = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(4000).default(""),
  assigneeId: uuid.optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: day.optional(),
});
@ApiTags("Tasks, documents and activity")
@Controller("projects/:id")
export class CollaborationController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
  ) {}
  @Get("tasks") async tasks(@Req() req: Request, @Param("id") id: string) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.task.findMany({
      where: { orgId: ctx.orgId, projectId: id },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 100,
    });
  }
  @Post("tasks") async create(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "task.manage", id),
      input = parse(taskInput, body);
    if (input.assigneeId && !ctx.permissions.includes("project.edit"))
      throw new ForbiddenException(
        "Task assignment requires project editing access",
      );
    return this.db.serial(async (tx) => {
      if (
        input.assigneeId &&
        !(await tx.projectMember.findFirst({
          where: {
            projectId: id,
            orgId: ctx.orgId,
            membership: {
              userId: input.assigneeId,
              active: true,
              role: { permissions: { has: "project.view" } },
            },
          },
        }))
      )
        throw new ConflictException(
          "Assignee must be an active project member",
        );
      const row = await tx.task.create({
        data: {
          orgId: ctx.orgId,
          projectId: id,
          ...input,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        },
      });
      await audit(tx, ctx, "task.created", row.id, {
        assignee: row.assigneeId,
      });
      return row;
    });
  }
  @Patch("tasks/:task") async edit(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("task") task: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "task.manage", id);
    const taskId = parse(uuid, task);
    const manager = ctx.permissions.includes("project.edit");
    const input = manager
      ? parse(
          taskInput
            .partial()
            .extend({
              assigneeId: uuid.nullable().optional(),
              dueDate: day.nullable().optional(),
              version: z.number().int().positive(),
              status: z
                .enum([
                  "TODO",
                  "IN_PROGRESS",
                  "BLOCKED",
                  "IN_REVIEW",
                  "CHANGES_REQUESTED",
                  "DONE",
                ])
                .optional(),
            })
            .strict(),
          body,
        )
      : parse(
          z
            .object({
              version: z.number().int().positive(),
              status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"]),
            })
            .strict(),
          body,
        );
    return this.db.serial(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id: taskId, orgId: ctx.orgId, projectId: id },
      });
      if (!existing) throw new NotFoundException("Task not found");
      if (
        !manager &&
        (existing.assigneeId !== ctx.userId || existing.status === "DONE")
      )
        throw new ForbiddenException(
          "You can update progress only on your open assigned tasks",
        );
      if (input.status && input.status !== existing.status) {
        if (!manager && existing.status === "IN_REVIEW")
          throw new ForbiddenException(
            "Only a project manager can change a task awaiting review",
          );
        if (
          input.status === "IN_REVIEW" &&
          !["IN_PROGRESS", "CHANGES_REQUESTED"].includes(existing.status)
        )
          throw new ConflictException(
            "Start the task before submitting it for review",
          );
        if (
          input.status === "CHANGES_REQUESTED" &&
          existing.status !== "IN_REVIEW"
        )
          throw new ConflictException(
            "Only tasks awaiting review can be returned for changes",
          );
        if (
          existing.status === "IN_REVIEW" &&
          !["DONE", "CHANGES_REQUESTED"].includes(input.status)
        )
          throw new ConflictException(
            "Approve the submitted task or request changes",
          );
      }
      const { version, ...fields } = input;
      const assigneeId = "assigneeId" in fields ? fields.assigneeId : undefined;
      if (
        assigneeId &&
        !(await tx.projectMember.findFirst({
          where: {
            orgId: ctx.orgId,
            projectId: id,
            membership: {
              userId: assigneeId,
              active: true,
              role: { permissions: { has: "project.view" } },
            },
          },
        }))
      )
        throw new ConflictException(
          "Assignee must be an active project member with project access",
        );
      const dueDate = "dueDate" in fields ? fields.dueDate : undefined;
      const updated = await tx.task.updateMany({
        where: { id: taskId, orgId: ctx.orgId, projectId: id, version },
        data: {
          ...fields,
          dueDate: dueDate ? new Date(dueDate) : dueDate,
          version: { increment: 1 },
        },
      });
      if (!updated.count)
        throw new ConflictException("Task changed. Reload and try again.");
      await audit(tx, ctx, "task.updated", taskId, {
        ...(fields.status && fields.status !== existing.status
          ? { previousStatus: existing.status, status: fields.status }
          : {}),
        ...(assigneeId !== undefined && assigneeId !== existing.assigneeId
          ? { previousAssignee: existing.assigneeId, assignee: assigneeId }
          : {}),
      });
      return tx.task.findUniqueOrThrow({ where: { id: taskId } });
    });
  }
  @Get("activity") async activity(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    const ids = [
      id,
      ...(
        await this.db.workOrder.findMany({
          where: { orgId: ctx.orgId, projectId: id },
          select: { id: true },
        })
      ).map((r) => r.id),
      ...(
        await this.db.installation.findMany({
          where: { orgId: ctx.orgId, projectId: id },
          select: { id: true },
        })
      ).map((r) => r.id),
      ...(
        await this.db.invoice.findMany({
          where: { orgId: ctx.orgId, projectId: id },
          select: { id: true },
        })
      ).map((r) => r.id),
      ...(
        await this.db.stockMovement.findMany({
          where: { orgId: ctx.orgId, projectId: id },
          select: { id: true },
        })
      ).map((r) => r.id),
      ...(
        await this.db.importBatch.findMany({
          where: { orgId: ctx.orgId, projectId: id },
          select: { id: true },
        })
      ).map((r) => r.id),
    ];
    return this.db.audit.findMany({
      where: { orgId: ctx.orgId, resourceId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Get("notifications") async notifications(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.outbox.findMany({
      where: {
        orgId: ctx.orgId,
        kind: "NOTIFICATION",
        projectId: id,
      },
      select: { id: true, payload: true, availableAt: true },
      orderBy: { availableAt: "desc" },
      take: 50,
    });
  }
  @Get("documents") async documents(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.document.findMany({
      where: { orgId: ctx.orgId, projectId: id },
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Post("documents/upload") async upload(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "document.manage", id),
      input = parse(
        z
          .object({
            name: z
              .string()
              .min(1)
              .max(200)
              .refine((v) => !/[\\/\x00]/.test(v), "Invalid filename"),
            mimeType: z.enum(attachmentTypes),
            size: z.number().int().min(1),
            siteVisitId: uuid.optional(),
          })
          .refine(
            ({ mimeType, size, siteVisitId }) =>
              (siteVisitId ? siteMediaTypes : documentTypes).some(
                (type) => type === mimeType,
              ) && size <= attachmentSizeLimit(mimeType),
            "Unsupported file type or file size exceeds the limit",
          ),
        body,
      );
    if (input.siteVisitId)
      await requireOpenVisit(this.db, ctx, input.siteVisitId);
    const objectKey = `${ctx.orgId}/${id}/${randomUUID()}`;
    const signedUrl = await getSignedUrl(
      storage(true),
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: objectKey,
        ContentType: input.mimeType,
        ContentLength: input.size,
      }),
      { expiresIn: 300 },
    );
    const doc = await this.db.serial(async (tx) => {
      if (input.siteVisitId) await requireOpenVisit(tx, ctx, input.siteVisitId);
      const d = await tx.document.create({
        data: {
          orgId: ctx.orgId,
          projectId: id,
          objectKey,
          ...input,
          createdBy: ctx.userId,
        },
      });
      await audit(tx, ctx, "document.upload.authorized", d.id);
      return d;
    });
    return { id: doc.id, url: signedUrl, expiresIn: 300 };
  }
  @Post("documents/:doc/complete") async complete(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("doc") doc: string,
  ) {
    const ctx = await this.security.context(req, "document.manage", id);
    const row = await this.db.document.findFirst({
      where: { id: parse(uuid, doc), orgId: ctx.orgId, projectId: id },
    });
    if (!row) throw new NotFoundException("Document not found");
    if (row.siteVisitId) await requireOpenVisit(this.db, ctx, row.siteVisitId);
    const head = await storage().send(
      new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: row.objectKey,
      }),
    );
    if (head.ContentLength !== row.size || head.ContentType !== row.mimeType)
      throw new ConflictException("Uploaded file size or type does not match");
    return this.db.serial(async (tx) => {
      if (row.siteVisitId) await requireOpenVisit(tx, ctx, row.siteVisitId);
      await tx.outbox.upsert({
        where: { dedupeKey: `scan:${row.id}` },
        create: {
          orgId: ctx.orgId,
          kind: "SCAN",
          dedupeKey: `scan:${row.id}`,
          payload: { documentId: row.id },
        },
        update: {},
      });
      await audit(tx, ctx, "document.scan.queued", row.id);
      return { status: "QUARANTINED" };
    });
  }
  @Get("documents/:doc/download") async download(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("doc") doc: string,
  ) {
    const ctx = await this.security.context(req, "project.view", id);
    const row = await this.db.document.findFirst({
      where: {
        id: parse(uuid, doc),
        orgId: ctx.orgId,
        projectId: id,
        status: "CLEAN",
      },
    });
    if (!row)
      throw new NotFoundException(
        "Document is unavailable or awaiting security verification",
      );
    return {
      url: await getSignedUrl(
        storage(true),
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: row.objectKey,
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        }),
        { expiresIn: 60 },
      ),
    };
  }
}

@ApiTags("Staff workspace")
@Controller("workspace")
export class StaffWorkspaceController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
  ) {}

  @Get("my-tasks") async myTasks(@Req() req: Request, @Query() query: unknown) {
    const ctx = await this.security.context(req, "project.view");
    const { page, state } = parse(
      z.object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        state: z.enum(["open", "completed", "all"]).default("open"),
      }),
      query,
    );
    const where = {
      orgId: ctx.orgId,
      assigneeId: ctx.userId,
      project: this.security.projectFilter(ctx),
      ...(state === "all"
        ? {}
        : { status: state === "completed" ? "DONE" : { not: "DONE" } }),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.task.findMany({
        where,
        include: { project: { select: { id: true, name: true, code: true } } },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        skip: (page - 1) * 25,
        take: 25,
      }),
      this.db.task.count({ where }),
    ]);
    return { rows, total, page };
  }
}
