import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  ImageRun, PageOrientation, AlignmentType, BorderStyle
} from "docx";
import type { DocModel, Block } from "../docmodel";
import { normalizeRows } from "../docmodel";

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;
const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };

export async function writeDocx(doc: DocModel): Promise<Uint8Array> {
  const sections = doc.sections.map((s) => {
    const landscape = !!s.landscape;
    // Usable width in twips (A4 minus 1" margins) and matching EMU-ish pixel budget for images.
    const usablePx = landscape ? 900 : 600;
    const children: (Paragraph | Table)[] = [];
    if (s.title && !s.blocks.some((b) => b.type === "heading")) {
      children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2 }));
    }
    for (const b of s.blocks) children.push(...blockToDocx(b, usablePx));
    if (!children.length) children.push(new Paragraph(""));
    return {
      properties: {
        page: {
          size: landscape
            ? { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 }
            : { width: 11906, height: 16838 },
          margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }
        }
      },
      children
    };
  });
  const d = new Document({
    title: doc.title,
    creator: "ScanOnce",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [{
        reference: "ordered",
        levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }]
      }]
    },
    sections
  });
  const blob = await Packer.toBlob(d);
  return new Uint8Array(await blob.arrayBuffer());
}

function blockToDocx(b: Block, usablePx: number): (Paragraph | Table)[] {
  switch (b.type) {
    case "heading":
      return [new Paragraph({ text: b.text, heading: HEADINGS[b.level] })];
    case "paragraph":
      return [new Paragraph({ children: [new TextRun({ text: b.text, bold: b.bold })], spacing: { after: 120 } })];
    case "list":
      return b.items.map((t) =>
        b.ordered
          ? new Paragraph({ text: t, numbering: { reference: "ordered", level: 0 } })
          : new Paragraph({ text: t, bullet: { level: 0 } })
      );
    case "table": {
      const rows = normalizeRows(b.rows);
      if (!rows.length || !rows[0].length) return [];
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map((r, i) =>
            new TableRow({
              tableHeader: i === 0,
              children: r.map((c) =>
                new TableCell({
                  borders: { top: border, bottom: border, left: border, right: border },
                  children: [new Paragraph({ children: [new TextRun({ text: c, bold: i === 0 })] })]
                })
              )
            })
          )
        }),
        new Paragraph("")
      ];
    }
    case "image": {
      const scale = Math.min(1, usablePx / b.width, (usablePx * 1.35) / b.height);
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: b.mime === "image/png" ? "png" : "jpg",
              data: b.data,
              transformation: { width: Math.round(b.width * scale), height: Math.round(b.height * scale) }
            })
          ]
        })
      ];
    }
  }
}
