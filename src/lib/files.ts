export type Kind = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "text" | "locked" | "unknown";

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function baseName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "") || "document";
}

export function kindOf(file: { name: string; type?: string }): Kind {
  const ext = extOf(file.name);
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "pptx") return "pptx";
  if (ext === "txt" || ext === "csv" || ext === "md") return "text";
  if (ext === "locked") return "locked";
  if (/^(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/.test(ext) || file.type?.startsWith("image/")) return "image";
  return "unknown";
}

export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  zip: "application/zip",
  jpg: "image/jpeg",
  png: "image/png",
  locked: "application/octet-stream"
};

export function makeFile(bytes: Uint8Array | Blob, name: string): File {
  const type = MIME[extOf(name)] ?? "application/octet-stream";
  return new File([bytes as BlobPart], name, { type });
}

export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Parses page ranges such as "1-3, 5, 8-" into groups of zero-based page
 * indexes. Each comma-separated part becomes one group.
 */
export function parseRanges(input: string, pageCount: number): number[][] {
  const groups: number[][] = [];
  for (const raw of input.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    let from: number, to: number;
    if (m) {
      from = m[1] ? parseInt(m[1], 10) : 1;
      to = m[2] ? parseInt(m[2], 10) : pageCount;
    } else if (/^\d+$/.test(part)) {
      from = to = parseInt(part, 10);
    } else {
      throw new Error(`"${part}" is not a page or range`);
    }
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      throw new Error(`Page ${Math.max(from, to)} is outside this document (1-${pageCount})`);
    }
    const step = from <= to ? 1 : -1;
    const group: number[] = [];
    for (let p = from; p !== to + step; p += step) group.push(p - 1);
    groups.push(group);
  }
  if (!groups.length) throw new Error("Enter at least one page or range");
  return groups;
}

export async function zipFiles(files: File[]): Promise<File> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    for (let i = 2; used.has(name); i++) name = `${baseName(f.name)} (${i}).${extOf(f.name)}`;
    used.add(name);
    zip.file(name, await f.arrayBuffer());
  }
  const out = await zip.generateAsync({ type: "uint8array" });
  return makeFile(out, "ScanOnce files.zip");
}

/** True when running under Node (the test suite) rather than a browser. */
export const isNode = typeof process !== "undefined" && !!(process as any).versions?.node;
