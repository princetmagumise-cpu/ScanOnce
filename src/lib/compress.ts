import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { listImages, decodeImage, savePdf } from "./pdfops";
import { optimizePdf } from "./qpdf";
import { toCanvas, canvasToBytes, nextFrame } from "./image";
import { loadPdfJs, renderPageDpi } from "./pdfjs";

export type Level = "light" | "balanced" | "strong" | "flatten";

export const LEVELS: Record<Level, { label: string; hint: string; maxSide: number; quality: number }> = {
  light: { label: "Light", hint: "Lossless clean-up. Best quality.", maxSide: 0, quality: 0 },
  balanced: { label: "Balanced", hint: "Shrinks photos and scans. Good for email.", maxSide: 2000, quality: 0.72 },
  strong: { label: "Strong", hint: "Smallest size where text stays sharp and selectable.", maxSide: 1400, quality: 0.55 },
  flatten: { label: "Maximum", hint: "Turns every page into a picture. Text can't be selected afterwards.", maxSide: 0, quality: 0.5 }
};

type Progress = (msg: string) => void;

export async function compressPdf(bytes: Uint8Array, level: Level, progress: Progress): Promise<Uint8Array> {
  let out: Uint8Array;
  if (level === "flatten") {
    out = await flatten(bytes, progress);
  } else if (level === "light") {
    out = bytes;
  } else {
    out = await recompressImages(bytes, LEVELS[level].maxSide, LEVELS[level].quality, progress);
  }
  progress("Optimizing file structure…");
  try {
    out = await optimizePdf(out);
  } catch {
    /* keep the unoptimized result */
  }
  return out.length < bytes.length ? out : bytes;
}

async function recompressImages(bytes: Uint8Array, maxSide: number, quality: number, progress: Progress): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const images = listImages(doc);
  let i = 0;
  for (const img of images) {
    i++;
    progress(`Compressing image ${i} of ${images.length}…`);
    await nextFrame();
    const decoded = await decodeImage(img);
    if (!decoded) continue;
    const canvas = toCanvas(decoded, maxSide);
    if ("close" in decoded) decoded.close();
    const jpg = await canvasToBytes(canvas, "image/jpeg", quality);
    if (jpg.length >= img.stream.contents.length * 0.9) continue; // not worth it
    const d = img.stream.dict;
    const dict: Record<string, unknown> = {
      Type: "XObject",
      Subtype: "Image",
      Width: canvas.width,
      Height: canvas.height,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      Filter: "DCTDecode"
    };
    const replacement = doc.context.stream(jpg, dict as any);
    // Keep transparency and interpolation settings.
    for (const k of ["SMask", "Mask", "Interpolate", "Intent"]) {
      const v = d.get(PDFName.of(k));
      if (v) replacement.dict.set(PDFName.of(k), v);
    }
    replacement.dict.set(PDFName.of("Length"), PDFNumber.of(jpg.length));
    doc.context.assign(img.ref, replacement);
  }
  return savePdf(doc);
}

async function flatten(bytes: Uint8Array, progress: Progress): Promise<Uint8Array> {
  const proxy = await loadPdfJs(bytes);
  const out = await PDFDocument.create();
  try {
    for (let n = 1; n <= proxy.numPages; n++) {
      progress(`Flattening page ${n} of ${proxy.numPages}…`);
      const page = await proxy.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderPageDpi(page, 110, 1600);
      const jpg = await out.embedJpg(await canvasToBytes(canvas, "image/jpeg", 0.5));
      out.addPage([vp.width, vp.height]).drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
      page.cleanup();
    }
  } finally {
    proxy.loadingTask.destroy();
  }
  return savePdf(out);
}
