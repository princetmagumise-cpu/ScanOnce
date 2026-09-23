import { PDFDocument } from "pdf-lib";
import { loadPdfJs, renderPageDpi } from "./pdfjs";
import { canvasToBytes } from "./image";
import { runQpdf } from "./qpdf";
import { savePdf } from "./pdfops";

export interface RepairResult {
  bytes: Uint8Array;
  method: string;
  pages: number;
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return d.getPageCount();
}

/**
 * Tries progressively more forceful ways to recover a damaged PDF:
 * 1. qpdf rewrite (fixes broken cross-reference tables and streams),
 * 2. pdf-lib, which rebuilds the file by scanning every object,
 * 3. pdf.js, which can often still draw pages from badly broken files; pages are rebuilt as images.
 */
export async function repairPdf(bytes: Uint8Array, progress: (msg: string) => void): Promise<RepairResult> {
  const errors: string[] = [];

  progress("Rebuilding file structure…");
  try {
    const out = await runQpdf(bytes, ["--object-streams=generate", "IN", "OUT"]);
    const pages = await pageCount(out);
    if (pages > 0) return { bytes: out, method: "Rebuilt the file structure (nothing lost)", pages };
  } catch (e) {
    errors.push((e as Error).message);
  }

  progress("Recovering objects…");
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    const count = doc.getPageCount();
    if (count > 0) {
      // Copy pages into a fresh document so broken leftovers are dropped.
      const fresh = await PDFDocument.create();
      const pages = await fresh.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => fresh.addPage(p));
      return { bytes: await savePdf(fresh), method: "Recovered pages and rebuilt the document", pages: count };
    }
  } catch (e) {
    errors.push((e as Error).message);
  }

  progress("Redrawing readable pages…");
  try {
    const proxy = await loadPdfJs(bytes);
    const out = await PDFDocument.create();
    let ok = 0;
    for (let n = 1; n <= proxy.numPages; n++) {
      try {
        progress(`Redrawing page ${n} of ${proxy.numPages}…`);
        const page = await proxy.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPageDpi(page, 200, 2600);
        const jpg = await out.embedJpg(await canvasToBytes(canvas, "image/jpeg", 0.85));
        out.addPage([vp.width, vp.height]).drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
        ok++;
      } catch {
        /* skip unreadable page */
      }
    }
    proxy.loadingTask.destroy();
    if (ok) {
      return {
        bytes: await savePdf(out),
        method: `Redrew ${ok} of ${proxy.numPages} pages as images (text is not selectable; run OCR to fix that)`,
        pages: ok
      };
    }
  } catch (e) {
    errors.push((e as Error).message);
  }
  throw new Error("This file is too badly damaged to recover." + (errors[0] ? ` (${errors[0].split("\n")[0]})` : ""));
}
