import PDFDocument from "pdfkit";
type ReportInput = {
  project: { name: string; code: string; city: string };
  asOf: Date;
  currency: string;
  rows: any[];
  invoices: any[];
};
export async function renderProjectReport(input: ReportInput): Promise<Buffer> {
  const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      bufferPages: true,
      info: {
        Title: `Project operations - ${input.project.name}`,
        Author: "Fieldwork",
      },
    }),
    chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = 507,
    ink = "#243a30",
    muted = "#758574",
    line = "#e2e9df";
  function header(title: string) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#62814c")
      .text("FIELDWORK / PROJECT OPERATIONS");
    doc.moveDown(1.5);
    doc.fontSize(23).fillColor(ink).text(title);
    doc.moveDown(0.5);
  }
  function section(title: string) {
    if (doc.y > 690) doc.addPage();
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(ink).text(title);
    doc.moveDown(0.7);
  }
  function table(headers: string[], rows: string[][], widths: number[]) {
    function row(values: string[], bold = false) {
      const height = Math.max(
        26,
        ...values.map(
          (v, i) =>
            doc
              .font(bold ? "Helvetica-Bold" : "Helvetica")
              .fontSize(8)
              .heightOfString(v, { width: widths[i] - 14 }) + 16,
        ),
      );
      if (doc.y + height > 748) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      let x = 44;
      if (bold) doc.rect(x, y, width, height).fill("#edf2e8");
      for (let i = 0; i < values.length; i++) {
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8)
          .fillColor(bold ? ink : muted)
          .text(values[i], x + 7, y + 8, { width: widths[i] - 14 });
        x += widths[i];
      }
      doc
        .moveTo(44, y + height)
        .lineTo(551, y + height)
        .strokeColor(line)
        .stroke();
      doc.y = y + height;
      doc.x = 44;
    }
    function drawHeader() {
      row(headers, true);
    }
    drawHeader();
    for (const values of rows) row(values);
  }
  header("Project progress & billing");
  doc.font("Helvetica-Bold").fontSize(15).text(input.project.name);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(muted)
    .text(`${input.project.code}  /  ${input.project.city}`, { lineGap: 5 });
  doc.moveDown();
  doc.text(`Reporting cutoff: ${input.asOf.toISOString().slice(0, 10)} (UTC)`);
  doc.text(`Currency: ${input.currency}`);
  section("Material delivery and installation");
  table(
    [
      "Material / UOM",
      "Ordered",
      "Supplied",
      "Installed",
      "Pending supply",
      "Pending install",
      "On hand",
    ],
    input.rows.map((r) => [
      `${r.material}\n${r.uom}`,
      r.ordered,
      r.supplied,
      r.installed,
      r.pendingSupply,
      r.pendingInstallation,
      r.available,
    ]),
    [159, 58, 58, 58, 58, 58, 58],
  );
  section("Unbilled quantities");
  table(
    ["Material", "Supply unbilled", "Installation unbilled"],
    input.rows.map((r) => [
      r.material,
      r.supplyUnbilled,
      r.installationUnbilled,
    ]),
    [257, 125, 125],
  );
  section("Issued invoices and collections");
  table(
    ["Invoice", "Type", "Invoiced", "Allocated paid", "Outstanding"],
    input.invoices.map((i) => [
      i.number,
      i.kind,
      i.total,
      i.paid,
      i.outstanding,
    ]),
    [139, 86, 94, 94, 94],
  );
  if (!input.invoices.length) {
    doc.moveDown();
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(muted)
      .text("No issued invoices at this reporting cutoff.");
  }
  section("Basis of this report");
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(muted)
    .text(
      "Opening quantities are imported historical balances, kept separately from operational movements. They do not establish historical invoice amounts or payment dates. Contract quantities reflect the current approved baseline. Operational balances use posting dates; corrections retain their original records.",
      { lineGap: 4 },
    );
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(muted)
      .text(
        `Fieldwork | ${input.project.code} | ${i + 1} / ${pages.count}`,
        44,
        785,
        { lineBreak: false },
      );
  }
  doc.end();
  return result;
}
