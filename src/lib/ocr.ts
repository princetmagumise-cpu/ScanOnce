import {
  PDFDocument, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize,
  setTextRenderingMode, TextRenderingMode, setTextMatrix, showText, type PDFPage, type PDFFont
} from "pdf-lib";
import { embedFonts, safeText } from "./fonts";
import { loadPdfJs, renderPageDpi } from "./pdfjs";
import { canvasToBytes, fileToCanvas } from "./image";
import { savePdf } from "./pdfops";

export { LANGUAGES } from "./languages";

export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number }
export interface OcrPage { text: string; words: OcrWord[]; width: number; height: number }

type Progress = (msg: string, fraction: number) => void;

let current: { langs: string; worker: Promise<any> } | null = null;

async function getWorker(langs: string, progress?: Progress) {
  if (current?.langs !== langs) {
    if (current) (await current.worker).terminate();
    const { createWorker } = await import("tesseract.js");
    current = {
      langs,
      worker: createWorker(langs.split("+"), 1, {
        logger: (m: any) => {
          if (m.status?.startsWith("loading")) progress?.("Downloading OCR language data (first time only)…", m.progress ?? 0);
        }
      })
    };
  }
  return current.worker;
}

export async function recognize(canvas: HTMLCanvasElement, langs: string, progress?: Progress): Promise<OcrPage> {
  const worker = await getWorker(langs, progress);
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          if (w.text?.trim() && w.confidence > 20) words.push({ text: w.text.trim(), ...w.bbox });
        }
      }
    }
  }
  return { text: data.text ?? "", words, width: canvas.width, height: canvas.height };
}

/** Maps a pixel position in the recognised image to PDF user space. */
export type PointMap = (x: number, y: number) => [number, number];

/**
 * Writes the recognised words as invisible, selectable text on top of a page.
 * By default the image is assumed to cover the whole (unrotated) page; pass
 * `map` when it sits elsewhere or the page is rotated.
 */
export function addTextLayer(page: PDFPage, font: PDFFont, ocr: OcrPage, map?: PointMap) {
  const k = page.getWidth() / ocr.width;
  const pageH = page.getHeight();
  const m: PointMap = map ?? ((x, y) => [x * k, pageH - y * k]);
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const w of ocr.words) {
    const text = safeText(font, w.text);
    if (!text) continue;
    const bx = w.x0, by = w.y1 - (w.y1 - w.y0) * 0.15; // baseline start, in pixels
    const [ox, oy] = m(bx, by);
    const [rx, ry] = m(w.x1, by); // end of the baseline
    const [tx, ty] = m(bx, w.y0); // top of the word
    const width = Math.hypot(rx - ox, ry - oy);
    const height = Math.hypot(tx - ox, ty - oy) / 0.85;
    if (!width || !height) continue;
    const size = Math.max(1, height * 0.9);
    const natural = font.widthOfTextAtSize(text, size);
    const hs = natural > 0 ? width / natural : 1;
    // Unit vectors along the baseline and "up", so rotated pages work too.
    const dx = (rx - ox) / width, dy = (ry - oy) / width;
    const upLen = Math.hypot(tx - ox, ty - oy);
    const ux = (tx - ox) / upLen, uy = (ty - oy) / upLen;
    ops.push(
      setFontAndSize(key, size),
      setTextMatrix(dx * hs, dy * hs, ux, uy, ox, oy),
      showText(font.encodeText(text))
    );
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

export interface OcrResult {
  pdf: Uint8Array;
  text: string;
}

/** Makes a scanned PDF searchable, keeping the original pages untouched underneath. */
export async function ocrPdf(bytes: Uint8Array, langs: string, progress: Progress): Promise<OcrResult> {
  const proxy = await loadPdfJs(bytes);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = (await embedFonts(out)).regular;
  const texts: string[] = [];
  try {
    for (let i = 1; i <= proxy.numPages; i++) {
      progress(`Reading text on page ${i} of ${proxy.numPages}…`, (i - 1) / proxy.numPages);
      const page = await proxy.getPage(i);
      const existing = await page.getTextContent();
      if ((existing.items as any[]).some((it) => it.str?.trim())) {
        // Already has real text: keep it, don't add a second layer.
        texts.push((existing.items as any[]).map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
        continue;
      }
      const canvas = await renderPageDpi(page, 300, 3500);
      const res = await recognize(canvas, langs, progress);
      texts.push(res.text);
      // pdf.js renders with the page's /Rotate applied; undo it for the text layer.
      // Map from the rendered (visual) page to PDF space, handling rotation.
      const vp = page.getViewport({ scale: 1 });
      const kv = vp.width / res.width;
      addTextLayer(out.getPage(i - 1), font, res, (x, y) => vp.convertToPdfPoint(x * kv, y * kv) as [number, number]);
      page.cleanup();
    }
  } finally {
    proxy.loadingTask.destroy();
  }
  progress("Saving…", 1);
  return { pdf: await savePdf(out), text: texts.join("\n\n") };
}

/** Scans (photos) to a searchable PDF. */
export async function ocrImages(files: Blob[], langs: string, progress: Progress): Promise<OcrResult> {
  const doc = await PDFDocument.create();
  const font = (await embedFonts(doc)).regular;
  const texts: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(`Reading text on image ${i + 1} of ${files.length}…`, i / files.length);
    const canvas = await fileToCanvas(files[i], 3000);
    const res = await recognize(canvas, langs, progress);
    texts.push(res.text);
    const jpg = await doc.embedJpg(await canvasToBytes(canvas, "image/jpeg", 0.85));
    const s = 72 / 200;
    const page = doc.addPage([canvas.width * s, canvas.height * s]);
    page.drawImage(jpg, { x: 0, y: 0, width: canvas.width * s, height: canvas.height * s });
    addTextLayer(page, font, res);
  }
  return { pdf: await savePdf(doc), text: texts.join("\n\n") };
}
