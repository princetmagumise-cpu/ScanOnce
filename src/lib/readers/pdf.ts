import type { Block, DocModel, Section } from "../docmodel";
import { loadPdfJs, renderPageDpi, type PDFDocumentProxy } from "../pdfjs";
import { canvasToBytes } from "../image";

interface Item { str: string; x: number; y: number; w: number; h: number }
interface Line { y: number; h: number; items: Item[] }

export interface PdfReadOptions {
  /** "text": rebuild editable text and tables; "image": each page as a picture (exact look). */
  mode: "text" | "image";
  /** Called with (pageNumber, pageCount). */
  progress?: (done: number, total: number) => void;
}

export async function readPdf(bytes: Uint8Array, title: string, opts: PdfReadOptions): Promise<DocModel> {
  const pdf = await loadPdfJs(bytes);
  try {
    return await readProxy(pdf, title, opts);
  } finally {
    pdf.loadingTask.destroy();
  }
}

async function readProxy(pdf: PDFDocumentProxy, title: string, opts: PdfReadOptions): Promise<DocModel> {
  const sections: Section[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    opts.progress?.(n, pdf.numPages);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const landscape = vp.width > vp.height;
    let blocks: Block[] = [];
    if (opts.mode === "text") {
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items as any[]) {
        if (typeof it.str !== "string" || !it.str.trim()) continue;
        // Convert to viewport coordinates (y grows downwards, rotation applied).
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
        items.push({ str: it.str, x, y, w: it.width, h });
      }
      blocks = layoutBlocks(items);
    }
    if (!blocks.length && typeof document !== "undefined") {
      // Scanned page (no text) or "exact look" mode: keep it as a picture.
      const canvas = await renderPageDpi(page, 150, 2200);
      const data = await canvasToBytes(canvas, "image/jpeg", 0.85);
      blocks.push({ type: "image", data, mime: "image/jpeg", width: canvas.width, height: canvas.height });
    }
    sections.push({ blocks, landscape });
    page.cleanup();
  }
  return { title, sections };
}

/** Groups positioned text into lines, then lines into headings, paragraphs and tables. */
export function layoutBlocks(items: Item[]): Block[] {
  if (!items.length) return [];
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last.y) < Math.max(2, Math.min(it.h, last.h) * 0.5)) {
      last.items.push(it);
      last.h = Math.max(last.h, it.h);
    } else {
      lines.push({ y: it.y, h: it.h, items: [it] });
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);

  const heights = lines.map((l) => l.h).sort((a, b) => a - b);
  const bodyH = heights[Math.floor(heights.length / 2)] || 10;

  // Split each line into cells wherever there is a wide horizontal gap.
  const cellsOf = (l: Line): { text: string; x: number }[] => {
    const cells: { text: string; x: number; end: number }[] = [];
    for (const it of l.items) {
      const c = cells[cells.length - 1];
      const gap = c ? it.x - c.end : Infinity;
      if (c && gap < l.h * 1.6) {
        c.text += (gap > l.h * 0.15 && !c.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
        c.end = Math.max(c.end, it.x + it.w);
      } else {
        cells.push({ text: it.str, x: it.x, end: it.x + it.w });
      }
    }
    return cells.map((c) => ({ text: c.text.trim(), x: c.x }));
  };

  const blocks: Block[] = [];
  let para: string[] = [];
  let paraBold = false;
  let prev: Line | null = null;
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ").replace(/\s+/g, " ").trim(), bold: paraBold || undefined });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    // A table is two or more consecutive multi-cell lines.
    if (cells.length >= 2) {
      let j = i;
      const rows: { text: string; x: number }[][] = [];
      while (j < lines.length) {
        const cj = cellsOf(lines[j]);
        if (cj.length < 2) break;
        rows.push(cj);
        j++;
      }
      if (rows.length >= 2) {
        flush();
        blocks.push({ type: "table", rows: alignColumns(rows) });
        prev = lines[j - 1];
        i = j - 1;
        continue;
      }
    }
    const line = lines[i];
    const text = cells.map((c) => c.text).join("   ");
    if (line.h > bodyH * 1.25 && text.length < 120) {
      flush();
      blocks.push({ type: "heading", level: line.h > bodyH * 1.7 ? 1 : 2, text });
      prev = line;
      continue;
    }
    const gap = prev ? line.y - prev.y : 0;
    if (prev && (gap > Math.max(line.h, prev.h) * 1.8 || /^([•●▪\-–*]|\d+[.)])\s/.test(text))) flush();
    para.push(text);
    prev = line;
  }
  flush();
  return blocks;
}

/** Assigns cells to columns by clustering their left edges. */
function alignColumns(rows: { text: string; x: number }[][]): string[][] {
  const xs = rows.flat().map((c) => c.x).sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) if (!cols.length || x - cols[cols.length - 1] > 12) cols.push(x);
  return rows.map((r) => {
    const out = new Array(cols.length).fill("");
    for (const c of r) {
      let best = 0;
      for (let k = 1; k < cols.length; k++) if (Math.abs(cols[k] - c.x) < Math.abs(cols[best] - c.x)) best = k;
      out[best] = out[best] ? out[best] + " " + c.text : c.text;
    }
    return out;
  });
}
