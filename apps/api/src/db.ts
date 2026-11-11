import { randomUUID } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super();
    return this.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            if (
              (model === "StockMovement" || model === "Audit") &&
              [
                "update",
                "updateMany",
                "delete",
                "deleteMany",
                "upsert",
              ].includes(operation)
            ) {
              throw new Error(
                "Immutable operational record: append a compensating entry",
              );
            }
            return query(args);
          },
        },
      },
    }) as unknown as Db;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
  async serial<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(
          async (tx) => {
            // MongoDB snapshots alone permit write skew across documents.
            // Force conflicting writers to retry before reading business state.
            const revision = randomUUID();
            await tx.writeLock.upsert({
              where: { id: "operations" },
              create: { id: "operations", revision },
              update: { revision },
            });
            return fn(tx);
          },
          { timeout: 15000 },
        );
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2034", "P2002"].includes(e.code) &&
          attempt < 4
        ) {
          await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  }
}
