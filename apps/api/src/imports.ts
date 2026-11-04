import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Req,
  Inject,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { Db } from "./db";
import { Security, audit, parse, hash } from "./security";
import { z, uuid, day, Decimal } from "@pmt/shared";
const aliases: Record<string, string[]> = {
  material: ["material", "material name", "item", "item description"],
  ordered: ["ordered qty", "ordered quantity", "order qty"],
  supplied: ["supplied qty", "supplied quantity"],
  installed: ["installed at site", "installed qty", "installed quantity"],
  supplyBilled: ["supplied billed qty", "supply billed qty"],
  installationBilled: ["installation billed qty", "installed billed qty"],
  pendingSupply: ["pending supply"],
  pendingInstallation: ["pending installation"],
  supplyUnbilled: ["supplied unbilled qty"],
  installationUnbilled: ["installation unbilled qty"],
};
const normalize = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\n\r]+/g, " ")
    .replace(/\s+/g, " ");
function validateArchive(buffer: Buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new ConflictException("Invalid XLSX archive");
  const count = buffer.readUInt16LE(end + 10),
    offset = buffer.readUInt32LE(end + 16);
  if (count > 2000 || offset >= buffer.length)
    throw new ConflictException("Workbook archive exceeds safe limits");
  let cursor = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    )
      throw new ConflictException("Invalid workbook directory");
    const size = buffer.readUInt32LE(cursor + 24);
    total += size;
    if (size === 0xffffffff || total > 50 * 1024 * 1024)
      throw new ConflictException("Expanded workbook exceeds 50 MB");
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
}
const sourceInput = z.object({
  fileName: z.string().min(1).max(200),
  content: z.string().max(7000000),
  sheet: z.string().max(100).optional(),
  headerRow: z.number().int().min(1).max(200).optional(),
  mapping: z.record(z.number().int().min(0).max(199)).optional(),
  skipRows: z.array(z.number().int().min(1).max(10000)).max(10000).default([]),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
});
export async function previewSource(input: z.infer<typeof sourceInput>) {
  const buffer = Buffer.from(input.content, "base64");
  if (buffer.length > 5 * 1024 * 1024)
    throw new ConflictException("File exceeds 5 MB");
  let rows: string[][] = [];
  if (/\.csv$/i.test(input.fileName)) {
    try {
      rows = parseCsv(buffer.toString("utf8"), {
        bom: true,
        relax_column_count: true,
        skip_empty_lines: false,
        max_record_size: 100000,
      });
    } catch {
      throw new ConflictException(
        "CSV structure is invalid. Check quotes and row delimiters.",
      );
    }
  } else if (/\.xlsx$/i.test(input.fileName)) {
    if (buffer.subarray(0, 2).toString() !== "PK")
      throw new ConflictException("Invalid XLSX signature");
    validateArchive(buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new ConflictException("Workbook could not be parsed");
    }
    const sheet = input.sheet ? wb.getWorksheet(input.sheet) : wb.worksheets[0];
    if (!sheet) throw new ConflictException("Worksheet not found");
    if (sheet.rowCount > 10000 || sheet.columnCount > 200)
      throw new ConflictException(
        "Worksheet exceeds 10,000 rows or 200 columns",
      );
    sheet.eachRow({ includeEmpty: true }, (row) => {
      rows[row.number - 1] = Array.from(
        { length: sheet.columnCount },
        (_, i) => row.getCell(i + 1).text,
      );
    });
  } else throw new ConflictException("Only CSV and XLSX are supported");
  if (rows.length > 10000 || rows.some((r) => r.length > 200))
    throw new ConflictException("File exceeds 10,000 rows or 200 columns");
  const auto = rows.findIndex(
    (r) =>
      r.some((c) => aliases.material.includes(normalize(c))) &&
      r.some((c) => aliases.ordered.includes(normalize(c))),
  );
  const headerIndex = input.headerRow ? input.headerRow - 1 : auto;
  if (headerIndex < 0 || !rows[headerIndex])
    throw new ConflictException(
      "Material header not found. Choose the header row and mappings.",
    );
  const headers = rows[headerIndex],
    mapping =
      input.mapping ||
      Object.fromEntries(
        Object.entries(aliases).flatMap(([key, values]) => {
          const index = headers.findIndex((c) => values.includes(normalize(c)));
          return index < 0 ? [] : [[key, index]];
        }),
      );
  if (
    mapping.material === undefined ||
    mapping.ordered === undefined ||
    mapping.supplied === undefined ||
    mapping.installed === undefined
  )
    throw new ConflictException(
      "Map material, ordered, supplied and installed columns",
    );
  const warnings: string[] = [];
  if (
    mapping.supplyBilled === undefined ||
    mapping.installationBilled === undefined
  )
    warnings.push(
      "Missing historical billed columns will be treated as zero only after explicit confirmation.",
    );
  const dateColumns = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(h));
  if (dateColumns.length)
    warnings.push(
      "Date-wise source columns are preserved as source evidence. No historical events will be invented.",
    );
  const records: any[] = [];
  const seen = new Set<string>();
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (input.skipRows.includes(i + 1) || row.every((c) => !normalize(c)))
      continue;
    const material = String(row[mapping.material] || "").trim(),
      errors: string[] = [];
    if (!material || /^(grand total|total|subtotal)$/i.test(material)) {
      warnings.push(`Row ${i + 1} skipped: blank material or summary row.`);
      continue;
    }
    if (seen.has(normalize(material)))
      errors.push("Duplicate material name in this source");
    seen.add(normalize(material));
    const values: Record<string, string> = {};
    for (const key of [
      "ordered",
      "supplied",
      "installed",
      "supplyBilled",
      "installationBilled",
    ]) {
      const raw =
        mapping[key] === undefined
          ? "0"
          : String(row[mapping[key]] ?? "")
              .replace(/,/g, "")
              .trim();
      if (!/^\d{1,14}(\.\d{1,4})?$/.test(raw)) {
        errors.push(`${key}: a nonnegative decimal is required`);
        values[key] = "0";
      } else values[key] = new Decimal(raw).toFixed();
    }
    const d = (key: string) => new Decimal(values[key]);
    if (d("ordered").lte(0)) errors.push("Ordered quantity must be positive");
    if (d("supplied").gt(d("ordered")))
      errors.push("Supplied quantity exceeds approved order");
    if (d("installed").gt(d("supplied")))
      errors.push("Installed quantity exceeds accepted supplied quantity");
    if (
      d("supplyBilled").gt(d("supplied")) ||
      d("installationBilled").gt(d("installed"))
    )
      errors.push("Billed quantity exceeds eligible quantity");
    const derived = {
      pendingSupply: d("ordered").minus(d("supplied")),
      pendingInstallation: d("ordered").minus(d("installed")),
      supplyUnbilled: d("supplied").minus(d("supplyBilled")),
      installationUnbilled: d("installed").minus(d("installationBilled")),
    };
    for (const [key, value] of Object.entries(derived))
      if (
        mapping[key] !== undefined &&
        String(row[mapping[key]] ?? "").trim()
      ) {
        const raw = String(row[mapping[key]]).replace(/,/g, "").trim();
        if (!/^\d+(\.\d+)?$/.test(raw) || !value.eq(raw))
          errors.push(`${key} does not reconcile with source totals`);
      }
    records.push({ sourceRow: i + 1, material, ...values, errors });
  }
  if (!records.length) throw new ConflictException("No material records found");
  if (dateColumns.length && !input.dateFormat)
    warnings.push(
      "Confirm a source date format before importing date columns.",
    );
  return {
    sourceHash: hash(buffer.toString("base64")),
    headerRow: headerIndex + 1,
    headers,
    mapping,
    metadata: rows
      .slice(0, headerIndex)
      .map((values, i) => ({ row: i + 1, values })),
    records,
    warnings,
    hasErrors: records.some((r) => r.errors.length),
    rawRows: rows,
    dateColumns: dateColumns.length,
  };
}
@ApiTags("Historical tracker import")
@Controller("projects/:id/imports")
export class ImportsController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
  ) {}
  @Get() async list(@Req() req: Request, @Param("id") id: string) {
    const ctx = await this.security.context(req, "project.view", id);
    return this.db.importBatch.findMany({
      where: { orgId: ctx.orgId, projectId: id },
      select: {
        id: true,
        sourceName: true,
        sourceHash: true,
        asOf: true,
        createdAt: true,
        reversedAt: true,
      },
    });
  }
  @Post("preview") async preview(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    await this.security.context(req, "import.create", id);
    return previewSource(parse(sourceInput, body));
  }
  @Post("confirm") async confirm(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "import.create", id),
      input = parse(
        sourceInput.extend({
          workOrderId: uuid,
          asOf: day,
          confirmed: z.literal(true),
          acceptedReceiptAssumption: z.literal(true),
          acknowledgeWarnings: z.literal(true),
        }),
        body,
      );
    const preview = await previewSource(input);
    if (preview.hasErrors)
      throw new ConflictException(
        "Resolve all reconciliation errors before confirming",
      );
    if (preview.dateColumns && !input.dateFormat)
      throw new ConflictException("Choose the source date format");
    if (new Date(input.asOf) > new Date())
      throw new ConflictException(
        "Opening balances cannot be dated in the future",
      );
    return this.db.serial(async (tx) => {
      if (
        await tx.importBatch.findUnique({
          where: {
            orgId_sourceHash: {
              orgId: ctx.orgId,
              sourceHash: preview.sourceHash,
            },
          },
        })
      )
        throw new ConflictException("This source has already been imported");
      const wo = await tx.workOrder.findFirst({
        where: { id: input.workOrderId, orgId: ctx.orgId, projectId: id },
        include: { items: { include: { material: true } } },
      });
      if (!wo) throw new NotFoundException("Work order not found");
      const batch = await tx.importBatch.create({
        data: {
          orgId: ctx.orgId,
          projectId: id,
          sourceHash: preview.sourceHash,
          sourceName: input.fileName,
          asOf: new Date(input.asOf),
          mapping: {
            columns: preview.mapping,
            headerRow: preview.headerRow,
            skipRows: input.skipRows,
            dateFormat: input.dateFormat || null,
            acceptedReceiptAssumption: true,
          },
          source: preview.rawRows,
        },
      });
      for (const record of preview.records) {
        const item = wo.items.find(
          (i) => normalize(i.material.name) === normalize(record.material),
        );
        if (!item)
          throw new ConflictException(
            `Create a BOQ item for ${record.material} before importing`,
          );
        if (!item.ordered.equals(record.ordered))
          throw new ConflictException(
            `Ordered quantity for ${record.material} differs from BOQ`,
          );
        if (
          new Decimal(record.supplied).decimalPlaces() >
            item.material.precision ||
          new Decimal(record.installed).decimalPlaces() >
            item.material.precision
        )
          throw new ConflictException(
            `Invalid precision for ${record.material}`,
          );
        if (
          (await tx.openingBalance.count({
            where: { boqItemId: item.id, batch: { reversedAt: null } },
          })) ||
          (await tx.stockMovement.count({ where: { boqItemId: item.id } })) ||
          (await tx.installation.count({ where: { boqItemId: item.id } })) ||
          (await tx.invoiceLine.count({ where: { boqItemId: item.id } }))
        )
          throw new ConflictException(
            "Opening balances must precede operational activity and cannot overlap an existing opening",
          );
        await tx.openingBalance.create({
          data: {
            orgId: ctx.orgId,
            batchId: batch.id,
            boqItemId: item.id,
            supplied: record.supplied,
            installed: record.installed,
            supplyBilled: record.supplyBilled,
            installationBilled: record.installationBilled,
            sourceRow: record.sourceRow,
          },
        });
      }
      await audit(tx, ctx, "import.confirmed", batch.id, {
        sourceHash: preview.sourceHash,
        rows: preview.records.length,
      });
      return { id: batch.id, importedRows: preview.records.length };
    });
  }
  @Post(":batch/reverse") async reverse(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("batch") batchId: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.security.context(req, "import.create", id),
      input = parse(z.object({ reason: z.string().min(5).max(1000) }), body);
    return this.db.serial(async (tx) => {
      const batch = await tx.importBatch.findFirst({
        where: { id: parse(uuid, batchId), projectId: id, orgId: ctx.orgId },
        include: { openings: true },
      });
      if (!batch || batch.reversedAt)
        throw new ConflictException("Batch is unavailable or already reversed");
      const items = batch.openings.map((o) => o.boqItemId);
      if (
        (await tx.stockMovement.count({
          where: { boqItemId: { in: items } },
        })) ||
        (await tx.invoiceLine.count({ where: { boqItemId: { in: items } } })) ||
        (await tx.installation.count({ where: { boqItemId: { in: items } } }))
      )
        throw new ConflictException(
          "Downstream operations exist. Resolve them before changing opening balances",
        );
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { reversedAt: new Date() },
      });
      await audit(tx, ctx, "import.reversed", batch.id, input);
      return { ok: true };
    });
  }
}
