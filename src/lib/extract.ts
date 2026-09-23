import type { PDFDocument } from "pdf-lib";
import { listImages, decodeImage } from "./pdfops";
import { loadPdfJs } from "./pdfjs";
import { toCanvas, canvasToBytes } from "./image";
import { makeFile } from "./files";

export async function extractText(bytes: Uint8Array): Promise<string> {
  const pdf = await loadPdfJs(bytes);
  const pages: string[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const c = await page.getTextContent();
      let s = "";
      for (const it of c.items as any[]) if (typeof it.str === "string") s += it.str + (it.hasEOL ? "\n" : "");
      pages.push(s.trim());
      page.cleanup();
    }
  } finally {
    pdf.loadingTask.destroy();
  }
  return pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join("\n\n");
}

export async function extractImages(doc: PDFDocument, stem: string, minSide = 32): Promise<File[]> {
  const files: File[] = [];
  let n = 0;
  for (const img of listImages(doc)) {
    if (img.width < minSide || img.height < minSide) continue;
    n++;
    if (img.filter === "DCTDecode" && img.components !== 4) {
      // JPEGs can be saved as-is, with no quality loss.
      files.push(makeFile(img.stream.contents, `${stem} image ${n}.jpg`));
      continue;
    }
    const decoded = await decodeImage(img);
    if (!decoded) { n--; continue; }
    const png = await canvasToBytes(toCanvas(decoded), "image/png");
    files.push(makeFile(png, `${stem} image ${n}.png`));
  }
  return files;
}
