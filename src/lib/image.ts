// Canvas helpers shared by the scanner, compressor, OCR and converters.

export type Source = HTMLCanvasElement | ImageBitmap | ImageData;

export async function fileToCanvas(file: Blob, maxSide = 4000): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // Older Safari: fall back to an <img> element.
    bmp = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image format isn't supported here")); };
      img.src = url;
    });
  }
  const w = "naturalWidth" in bmp ? bmp.naturalWidth : bmp.width;
  const h = "naturalHeight" in bmp ? bmp.naturalHeight : bmp.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = makeCanvas(Math.round(w * s), Math.round(h * s));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  if ("close" in bmp) bmp.close();
  return c;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export function toCanvas(src: Source, maxSide = Infinity): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = makeCanvas(Math.round(src.width * s), Math.round(src.height * s));
  const ctx = c.getContext("2d")!;
  if (src instanceof ImageData) {
    if (s === 1) ctx.putImageData(src, 0, 0);
    else ctx.drawImage(toCanvas(src), 0, 0, c.width, c.height);
  } else {
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }
  return c;
}

export function canvasToBytes(c: HTMLCanvasElement, type: "image/jpeg" | "image/png", quality = 0.85): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error("Could not encode image"))),
      type,
      quality
    )
  );
}

export function rotateCanvas(c: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (!q) return c;
  const out = makeCanvas(q % 2 ? c.height : c.width, q % 2 ? c.width : c.height);
  const ctx = out.getContext("2d")!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
