import type { Block, ImageMime } from "../docmodel";

/** Reads pixel dimensions from PNG or JPEG headers. */
export function imageSize(b: Uint8Array): { width: number; height: number; mime: ImageMime } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), mime: "image/png" };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], mime: "image/jpeg" };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Turns image bytes of any browser-decodable format into a PNG/JPEG image
 * block. Formats the platform can't decode (e.g. EMF/WMF) are skipped.
 */
export async function toImageBlock(bytes: Uint8Array, contentType = ""): Promise<Block | null> {
  const size = imageSize(bytes);
  if (size && size.width && size.height) return { type: "image", data: bytes, ...size };
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return null;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: contentType }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) return null;
    return { type: "image", data: new Uint8Array(await blob.arrayBuffer()), mime: "image/png", width: bmp.width, height: bmp.height };
  } catch {
    return null;
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/[ \s]+/g, " ").trim();
}
