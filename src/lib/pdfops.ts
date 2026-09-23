import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFNumber, PDFArray, PDFRef, degrees, decodePDFRawStream } from "pdf-lib";
import { decryptPdf, QpdfError } from "./qpdf";
import { readBytes, baseName, makeFile } from "./files";

/** Asks the user for a password. Returns null if they cancel. */
export type AskPassword = (fileName: string, wrongBefore: boolean) => Promise<string | null>;

export class UserCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

export interface OpenedPdf {
  name: string;
  bytes: Uint8Array; // decrypted bytes
  doc: PDFDocument;
}

/**
 * Loads a PDF for editing. Password-protected files are unlocked first
 * (asking for the password when one is needed to open the file).
 */
export async function openPdf(file: File | { name: string; bytes: Uint8Array }, ask?: AskPassword): Promise<OpenedPdf> {
  const name = file.name;
  let bytes = file instanceof Blob ? await readBytes(file) : file.bytes;
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new Error(`"${name}" could not be read. It may be damaged; try the Repair tool.`);
  }
  if (doc.isEncrypted) {
    bytes = await unlockBytes(name, bytes, ask);
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  }
  return { name, bytes, doc };
}

export async function unlockBytes(name: string, bytes: Uint8Array, ask?: AskPassword): Promise<Uint8Array> {
  // Many PDFs only carry an "owner" password (restrictions) and open without one.
  try {
    return await decryptPdf(bytes, "");
  } catch (e) {
    if (!(e instanceof QpdfError) || !/password/i.test(e.message)) throw e;
  }
  if (!ask) throw new Error(`"${name}" is password protected.`);
  let wrong = false;
  for (;;) {
    const pw = await ask(name, wrong);
    if (pw === null) throw new UserCancelled();
    try {
      return await decryptPdf(bytes, pw);
    } catch (e) {
      if (e instanceof QpdfError && /password/i.test(e.message)) {
        wrong = true;
        continue;
      }
      throw e;
    }
  }
}

export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  doc.setProducer("ScanOnce");
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: true });
}

// ---------- Merge ----------

export async function mergePdfs(docs: PDFDocument[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const src of docs) {
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return savePdf(out);
}

// ---------- Split / extract pages ----------

export async function pagesToPdf(src: PDFDocument, indexes: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indexes);
  pages.forEach((p) => out.addPage(p));
  return savePdf(out);
}

export async function splitPdf(src: PDFDocument, groups: number[][], name: string): Promise<File[]> {
  const files: File[] = [];
  const stem = baseName(name);
  for (const g of groups) {
    const label = g.length === 1 ? `page ${g[0] + 1}` : `pages ${g[0] + 1}-${g[g.length - 1] + 1}`;
    files.push(makeFile(await pagesToPdf(src, g), `${stem} (${label}).pdf`));
  }
  return files;
}

export function everyN(pageCount: number, n: number): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < pageCount; i += n) {
    groups.push(Array.from({ length: Math.min(n, pageCount - i) }, (_, k) => i + k));
  }
  return groups;
}

// ---------- Organize ----------

/** One page in the output: which source document/page it comes from, extra rotation, or a blank page. */
export interface PagePlan {
  src: number; // index into the sources array, or -1 for a blank page
  page: number;
  rotate: number; // extra clockwise rotation in degrees
}

export async function buildFromPlan(sources: PDFDocument[], plan: PagePlan[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const item of plan) {
    if (item.src < 0) {
      const ref = out.getPageCount() ? out.getPage(out.getPageCount() - 1).getSize() : { width: 595.28, height: 841.89 };
      out.addPage([ref.width, ref.height]);
      continue;
    }
    const [p] = await out.copyPages(sources[item.src], [item.page]);
    if (item.rotate) p.setRotation(degrees((p.getRotation().angle + item.rotate + 360) % 360));
    out.addPage(p);
  }
  return savePdf(out);
}

// ---------- Images to PDF ----------

export type PageSize = "a4" | "letter" | "fit";
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export interface PdfImage {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

export async function imagesToPdf(images: PdfImage[], size: PageSize, margin = 0): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const img of images) {
    const embedded = img.mime === "image/png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    let pw: number, ph: number;
    if (size === "fit") {
      // 150 dpi-equivalent keeps a sensible physical size for phone photos.
      const s = 72 / 150;
      pw = img.width * s + margin * 2;
      ph = img.height * s + margin * 2;
    } else {
      [pw, ph] = SIZES[size];
      if (img.width > img.height) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc;
}

// ---------- Embedded images ----------

export interface EmbeddedImage {
  ref: PDFRef;
  stream: PDFRawStream;
  width: number;
  height: number;
  filter: string;
  colorSpace: string;
  components: number;
  bpc: number;
}

function nameOf(v: unknown): string {
  if (v instanceof PDFName) return v.asString().replace(/^\//, "");
  if (v instanceof PDFArray && v.size() && v.get(0) instanceof PDFName) return nameOf(v.get(0));
  return "";
}

/** Lists the image objects in a PDF that we know how to decode. */
export function listImages(doc: PDFDocument): EmbeddedImage[] {
  const out: EmbeddedImage[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (nameOf(d.get(PDFName.of("Subtype"))) !== "Image") continue;
    if (d.get(PDFName.of("ImageMask"))) continue;
    const width = (d.get(PDFName.of("Width")) as PDFNumber)?.asNumber?.() ?? 0;
    const height = (d.get(PDFName.of("Height")) as PDFNumber)?.asNumber?.() ?? 0;
    const bpc = (d.get(PDFName.of("BitsPerComponent")) as PDFNumber)?.asNumber?.() ?? 8;
    let filter = nameOf(d.get(PDFName.of("Filter")));
    const filters = d.get(PDFName.of("Filter"));
    if (filters instanceof PDFArray && filters.size() > 1) filter = "multi";
    let cs = d.lookup(PDFName.of("ColorSpace"));
    let colorSpace = nameOf(cs);
    let components = colorSpace === "DeviceGray" || colorSpace === "CalGray" ? 1 : colorSpace === "DeviceCMYK" ? 4 : 3;
    if (colorSpace === "ICCBased" && cs instanceof PDFArray) {
      const icc = cs.lookup(1);
      const n = icc instanceof PDFRawStream ? (icc.dict.get(PDFName.of("N")) as PDFNumber)?.asNumber?.() : undefined;
      components = n ?? 3;
    }
    if (!width || !height) continue;
    out.push({ ref, stream: obj, width, height, filter, colorSpace, components, bpc });
  }
  return out;
}

/** Decodes an embedded image into RGBA pixels, or returns null for unsupported encodings. */
export async function decodeImage(img: EmbeddedImage): Promise<ImageBitmap | ImageData | null> {
  const d = img.stream.dict;
  if (d.get(PDFName.of("Decode"))) return null;
  if (img.filter === "DCTDecode") {
    if (img.components === 4) return null; // CMYK JPEGs come out with wrong colours in browsers
    try {
      return await createImageBitmap(new Blob([img.stream.contents as BlobPart], { type: "image/jpeg" }));
    } catch {
      return null;
    }
  }
  if (img.filter === "FlateDecode" && img.bpc === 8 && (img.components === 1 || img.components === 3)) {
    if (!["DeviceRGB", "DeviceGray", "ICCBased", "CalRGB", "CalGray"].includes(img.colorSpace)) return null;
    const parms = d.lookup(PDFName.of("DecodeParms"));
    if (parms instanceof PDFDict && parms.get(PDFName.of("Predictor"))) return null;
    let raw: Uint8Array;
    try {
      raw = decodePDFRawStream(img.stream).decode();
    } catch {
      return null;
    }
    const px = img.width * img.height;
    if (raw.length < px * img.components) return null;
    const rgba = new Uint8ClampedArray(px * 4);
    for (let i = 0, j = 0; i < px; i++) {
      if (img.components === 1) {
        const g = raw[i];
        rgba[j++] = g; rgba[j++] = g; rgba[j++] = g;
      } else {
        rgba[j++] = raw[i * 3]; rgba[j++] = raw[i * 3 + 1]; rgba[j++] = raw[i * 3 + 2];
      }
      rgba[j++] = 255;
    }
    return new ImageData(rgba, img.width, img.height);
  }
  return null;
}
