import ExcelJS from "exceljs";
import type { DocModel } from "../docmodel";

function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

/** Numbers stay numbers in Excel, so formulas and sorting work. */
function cellValue(s: string): string | number {
  const t = s.trim();
  if (/^-?\d{1,15}(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return Number(t);
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  return s;
}

export async function writeXlsx(doc: DocModel, onePerSection = true): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ScanOnce";
  const used = new Set<string>();
  const sections = onePerSection ? doc.sections : [{ title: doc.title, blocks: doc.sections.flatMap((s) => s.blocks) }];

  sections.forEach((s, i) => {
    const title = s.title || (sections.length > 1 ? `${sections === doc.sections ? "Page" : "Sheet"} ${i + 1}` : doc.title);
    const ws = wb.addWorksheet(sheetName(title, used));
    const widths: number[] = [];
    const add = (cells: string[], opts: { bold?: boolean; size?: number; header?: boolean } = {}) => {
      const row = ws.addRow(cells.map(cellValue));
      cells.forEach((c, k) => (widths[k] = Math.max(widths[k] ?? 8, Math.min(60, c.length + 2))));
      if (opts.bold || opts.size || opts.header) row.font = { bold: opts.bold || opts.header, size: opts.size };
      if (opts.header) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EFEE" } };
        });
      }
    };
    for (const b of s.blocks) {
      if (b.type === "table") {
        b.rows.forEach((r, k) => add(r, { header: k === 0 && b.rows.length > 1 }));
        ws.addRow([]);
      } else if (b.type === "heading") {
        add([b.text], { bold: true, size: b.level === 1 ? 14 : 12 });
      } else if (b.type === "paragraph") {
        add([b.text], { bold: b.bold });
      } else if (b.type === "list") {
        b.items.forEach((t) => add([t]));
      }
    }
    ws.columns.forEach((col, k) => (col.width = widths[k] ?? 10));
  });
  if (!wb.worksheets.length) wb.addWorksheet("Sheet1");
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
