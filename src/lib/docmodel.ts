// A small, format-neutral description of a document. Every reader turns a file
// into a DocModel and every writer turns a DocModel into a file, so any input
// format can be converted to any output format.

export type ImageMime = "image/png" | "image/jpeg";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string; bold?: boolean }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "table"; rows: string[][] }
  | { type: "image"; data: Uint8Array; mime: ImageMime; width: number; height: number };

/** One page, slide or worksheet. */
export interface Section {
  title?: string;
  blocks: Block[];
  /** Hint for page-shaped outputs, e.g. slides are landscape. */
  landscape?: boolean;
}

export interface DocModel {
  title: string;
  sections: Section[];
}

export function blockText(b: Block): string {
  switch (b.type) {
    case "heading":
    case "paragraph":
      return b.text;
    case "list":
      return b.items.map((it, i) => (b.ordered ? `${i + 1}. ` : "• ") + it).join("\n");
    case "table":
      return b.rows.map((r) => r.join("\t")).join("\n");
    case "image":
      return "";
  }
}

export function modelToText(doc: DocModel): string {
  return doc.sections
    .map((s) => s.blocks.map(blockText).filter(Boolean).join("\n\n"))
    .join("\n\n\f\n\n");
}

/** Pads rows so every row has the same number of cells. */
export function normalizeRows(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
}
