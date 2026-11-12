import "reflect-metadata";
import {
  Module,
  Controller,
  Get,
  Inject,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pino from "pino";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import { Db } from "./db";
import { Security } from "./security";
import { AuthController, AuthService, OrganizationController } from "./auth";
import { TeamsController } from "./teams";
import { ProjectsController } from "./projects";
import { ImportsController } from "./imports";
import { Operations, OperationsController } from "./operations";
import { ProcurementController } from "./procurement";
import { BillingController } from "./billing";
import {
  CollaborationController,
  StaffWorkspaceController,
} from "./collaboration";
import { ReportsController } from "./reports";
import { SiteVisitsController } from "./site-visits";
export const logger = pino({
  redact: [
    "req.headers.cookie",
    "req.headers.authorization",
    "password",
    "token",
    "payload",
  ],
});
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse(),
      req = host.switchToHttp().getRequest();
    let status = 500,
      message = "An unexpected error occurred",
      fields: unknown;
    if (error instanceof ZodError) {
      status = 400;
      message = "Validation failed";
      fields = error.flatten();
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.message;
      const response = error.getResponse();
      if (typeof response === "object" && "fields" in response)
        fields = response.fields;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        status = 409;
        message = "A record with this identifier already exists";
      } else if (error.code === "P2025") {
        status = 404;
        message = "Record not found";
      } else if (error.code === "P2003") {
        status = 400;
        message = "Invalid resource reference";
      }
    }
    if (status === 500) {
      logger.error(
        {
          errorType: error instanceof Error ? error.name : "UnknownError",
          errorCode:
            error instanceof Prisma.PrismaClientKnownRequestError
              ? error.code
              : undefined,
          requestId: req.requestId,
        },
        "Request failed",
      );
      const span = trace.getActiveSpan();
      if (error instanceof Error)
        span?.recordException({
          name: error.name,
          message: "Internal operation failed; correlate by request ID",
        });
      span?.setStatus({ code: SpanStatusCode.ERROR });
    }
    res.status(status).json({
      error: { code: status, message, fields, requestId: req.requestId },
    });
  }
}
@Controller()
class HealthController {
  constructor(@Inject(Db) readonly db: Db) {}
  @Get("health") health() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.db.$runCommandRaw({ ping: 1 });
    return { status: "ready" };
  }
}
@Module({
  controllers: [
    HealthController,
    AuthController,
    OrganizationController,
    TeamsController,
    ProjectsController,
    ImportsController,
    OperationsController,
    ProcurementController,
    BillingController,
    CollaborationController,
    StaffWorkspaceController,
    SiteVisitsController,
    ReportsController,
  ],
  providers: [Db, Security, AuthService, Operations],
})
export class AppModule {}
export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    bodyParser: true,
  });
  app.useBodyParser("json", { limit: "8mb" });
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: any, res: any, next: any) => {
    req.requestId = randomUUID();
    res.setHeader("x-request-id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== (process.env.APP_ORIGIN || "http://localhost:3000")
    )
      return res.status(403).json({
        error: {
          code: 403,
          message: "Origin is not allowed",
          requestId: req.requestId,
        },
      });
    const start = Date.now();
    res.on("finish", () =>
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
          requestId: req.requestId,
        },
        "http",
      ),
    );
    next();
  });
  app.useGlobalFilters(new Errors());
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Project Operations API")
      .setVersion("1.0")
      .addCookieAuth("pmt_session")
      .addApiKey(
        { type: "apiKey", in: "header", name: "x-organization-id" },
        "organization",
      )
      .build(),
  );
  SwaggerModule.setup("api/docs", app, doc);
  app.enableShutdownHooks();
  await app.init();
  return app;
}
