import { describe, it, expect } from "vitest";
import { previewSource } from "../apps/api/src/imports";
import { renderProjectReport } from "../apps/api/src/pdf-report";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
const requireApi = createRequire(resolve("apps/api/package.json"));
const ExcelJS = requireApi("exceljs");
describe("tracker formats and report rendering", () => {
  it("parses a real Excel workbook with metadata above the material header", async () => {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("Site progress");
    ws.addRows([
      ["Project", "Bagmane Capital Tech Park"],
      [],
      ["Material", "Ordered Qty", "Supplied Qty", "Installed at Site"],
      ["Bounce Pillar Guard", 2600, 500, 192],
    ]);
    const bytes = await wb.xlsx.writeBuffer();
    const result = await previewSource({
      fileName: "tracker.xlsx",
      content: Buffer.from(bytes).toString("base64"),
      skipRows: [],
    });
    expect(result.headerRow).toBe(3);
    expect(result.records[0].installed).toBe("192");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("supports custom mappings and skipped rows", async () => {
    const csv =
      "Metadata,Site\nName,Contract,Delivered,Fixed\nGuard,10,5,2\nIgnore,invalid,5,2";
    const r = await previewSource({
      fileName: "mapped.csv",
      content: Buffer.from(csv).toString("base64"),
      headerRow: 2,
      mapping: { material: 0, ordered: 1, supplied: 2, installed: 3 },
      skipRows: [4],
    });
    expect(r.records).toHaveLength(1);
    expect(r.hasErrors).toBe(false);
  });
  it("rejects malformed CSV and invalid workbook archives with actionable conflicts", async () => {
    await expect(
      previewSource({
        fileName: "bad.csv",
        content: Buffer.from('"unclosed').toString("base64"),
        skipRows: [],
      }),
    ).rejects.toThrow("CSV structure");
    await expect(
      previewSource({
        fileName: "bad.xlsx",
        content: Buffer.from("PKnot-a-workbook").toString("base64"),
        skipRows: [],
      }),
    ).rejects.toThrow("archive");
  });
  it("generates a multipage PDF without losing long material descriptions", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      material: `Bounce Pillar Guard - basement parking area ${i + 1}`,
      uom: "Nos",
      ordered: "2600",
      supplied: "500",
      installed: "192",
      pendingSupply: "2100",
      pendingInstallation: "2408",
      available: "308",
      supplyUnbilled: "500",
      installationUnbilled: "192",
    }));
    const bytes = await renderProjectReport({
      project: {
        name: "Bagmane Capital Tech Park",
        code: "BCTP",
        city: "Bangalore",
      },
      currency: "INR",
      asOf: new Date("2026-10-28"),
      rows,
      invoices: [
        {
          number: "INV-001",
          kind: "INSTALLATION",
          total: "4720.00",
          paid: "1000.00",
          outstanding: "3720.00",
        },
      ],
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    mkdirSync(".local", { recursive: true });
    writeFileSync(".local/report-layout-qa.pdf", bytes);
  });
});
