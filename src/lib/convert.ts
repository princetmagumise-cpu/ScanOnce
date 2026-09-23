import type { DocModel } from "./docmodel";
import { modelToText } from "./docmodel";
import { kindOf, baseName, readBytes, makeFile, type Kind } from "./files";
import { fileToCanvas, canvasToBytes } from "./image";

export type Target = "pdf" | "docx" | "xlsx" | "pptx" | "txt" | "jpg";

export const TARGET_LABEL: Record<Target, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  pptx: "PowerPoint",
  txt: "Text",
  jpg: "Images (JPG)"
};

export function targetsFor(kind: Kind): Target[] {
  switch (kind) {
    case "pdf": return ["docx", "xlsx", "pptx", "jpg", "txt"];
    case "docx": return ["pdf", "xlsx", "pptx", "txt"];
    case "xlsx": return ["pdf", "docx", "pptx", "txt"];
    case "pptx": return ["pdf", "docx", "xlsx", "txt"];
    case "image": return ["pdf", "docx", "pptx"];
    case "text": return ["pdf", "docx", "xlsx", "pptx"];
    default: return [];
  }
}

export interface ConvertOptions {
  pdfMode: "text" | "image";
  progress?: (msg: string) => void;
}

export async function readAny(file: File | { name: string; bytes: Uint8Array }, opts: ConvertOptions): Promise<DocModel> {
  const name = file.name;
  const bytes = file instanceof Blob ? await readBytes(file) : file.bytes;
  const title = baseName(name);
  switch (kindOf({ name })) {
    case "pdf": {
      const { readPdf } = await import("./readers/pdf");
      return readPdf(bytes, title, { mode: opts.pdfMode, progress: (d, t) => opts.progress?.(`Reading page ${d} of ${t}`) });
    }
    case "docx": return (await import("./readers/docx")).readDocx(bytes, title);
    case "xlsx": return (await import("./readers/xlsx")).readXlsx(bytes, title);
    case "pptx": return (await import("./readers/pptx")).readPptx(bytes, title);
    case "text": {
      const text = new TextDecoder().decode(bytes);
      if (/\.csv$/i.test(name)) {
        const rows = text.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
        return { title, sections: [{ blocks: [{ type: "table", rows }] }] };
      }
      const blocks = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((t) => ({ type: "paragraph" as const, text: t }));
      return { title, sections: [{ blocks }] };
    }
    case "image": {
      const c = await fileToCanvas(new Blob([bytes as BlobPart]), 2400);
      const data = await canvasToBytes(c, "image/jpeg", 0.9);
      return { title, sections: [{ blocks: [{ type: "image", data, mime: "image/jpeg", width: c.width, height: c.height }], landscape: c.width > c.height }] };
    }
    default:
      throw new Error(`ScanOnce can't read "${name}". Supported: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), images, text and CSV.`);
  }
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function writeAny(doc: DocModel, target: Target): Promise<File[]> {
  const name = `${doc.title}.${target}`;
  switch (target) {
    case "pdf": return [makeFile(await (await import("./writers/pdf")).writePdf(doc), name)];
    case "docx": return [makeFile(await (await import("./writers/docx")).writeDocx(doc), name)];
    case "xlsx": return [makeFile(await (await import("./writers/xlsx")).writeXlsx(doc), name)];
    case "pptx": return [makeFile(await (await import("./writers/pptx")).writePptx(doc), name)];
    case "txt": return [makeFile(new TextEncoder().encode(modelToText(doc)), `${doc.title}.txt`)];
    case "jpg": {
      const files: File[] = [];
      doc.sections.forEach((s, i) =>
        s.blocks.forEach((b) => {
          if (b.type === "image") files.push(makeFile(b.data, `${doc.title} page ${i + 1}.${b.mime === "image/png" ? "png" : "jpg"}`));
        })
      );
      return files;
    }
  }
}

/** Merges several documents (e.g. many images) into one. */
export function combine(docs: DocModel[], title: string): DocModel {
  return { title, sections: docs.flatMap((d) => d.sections) };
}
