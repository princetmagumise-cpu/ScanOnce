import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { isNode } from "./files";

const inBrowser = !isNode;
if (inBrowser) pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export async function loadPdfJs(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  // pdf.js takes ownership of (detaches) the buffer it is given, so pass a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: inBrowser ? "./pdfjs/cmaps/" : undefined,
    cMapPacked: true,
    standardFontDataUrl: inBrowser ? "./pdfjs/standard_fonts/" : undefined,
    stopAtErrors: false
  });
  return task.promise;
}

export function isPasswordError(e: unknown): boolean {
  return (e as { name?: string })?.name === "PasswordException";
}

/** Renders a page to a canvas so that it is `scale` times its size in points. */
export async function renderPage(page: PDFPageProxy, scale: number, rotation = 0): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Renders at roughly `dpi`, capped so very large pages don't exhaust memory on phones. */
export async function renderPageDpi(page: PDFPageProxy, dpi: number, maxSide = 3000): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  const side = Math.max(base.width, base.height) * scale;
  if (side > maxSide) scale *= maxSide / side;
  return renderPage(page, scale);
}
