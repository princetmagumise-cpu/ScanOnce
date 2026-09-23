import ExcelJS from "exceljs";
import type { DocModel, Section } from "../docmodel";

export async function readXlsx(bytes: Uint8Array, title: string): Promise<DocModel> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.slice().buffer as ArrayBuffer);
  const sections: Section[] = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cellText(cell);
      });
      rows[rowNumber - 1] = Array.from(cells, (c) => c ?? "");
    });
    const dense = Array.from(rows, (r) => r ?? []);
    // Trim empty trailing rows and columns.
    while (dense.length && dense[dense.length - 1].every((c) => !c)) dense.pop();
    const width = Math.max(0, ...dense.map((r) => {
      let w = r.length;
      while (w && !r[w - 1]) w--;
      return w;
    }));
    const table = dense.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
    const landscape = width > 6;
    sections.push({ title: ws.name, blocks: table.length ? [{ type: "table", rows: table }] : [], landscape });
  });
  return { title, sections };
}

function cellText(cell: ExcelJS.Cell): string {
  try {
    const t = cell.text;
    if (t !== undefined && t !== null) return String(t);
  } catch {
    /* fall through */
  }
  const v: any = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if ("result" in v) return String(v.result ?? "");
    if ("richText" in v) return v.richText.map((r: any) => r.text).join("");
    if ("text" in v) return String(v.text);
    if (v instanceof Date) return v.toLocaleDateString();
  }
  return String(v);
}
