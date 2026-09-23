// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parseRanges } from "../src/lib/files";
import { lockBytes, unlockBytes, isLocked, WrongPassword } from "../src/lib/vault";
import { encryptPdf } from "../src/lib/qpdf";
import { openPdf, mergePdfs, splitPdf, everyN, buildFromPlan } from "../src/lib/pdfops";
import { repairPdf } from "../src/lib/repair";
import type { DocModel } from "../src/lib/docmodel";
import { writeDocx } from "../src/lib/writers/docx";
import { writeXlsx } from "../src/lib/writers/xlsx";
import { writePptx } from "../src/lib/writers/pptx";
import { writePdf } from "../src/lib/writers/pdf";
import { readDocx } from "../src/lib/readers/docx";
import { readXlsx } from "../src/lib/readers/xlsx";
import { readPptx } from "../src/lib/readers/pptx";
import { readPdf } from "../src/lib/readers/pdf";
import { extractText } from "../src/lib/extract";
import { addTextLayer } from "../src/lib/ocr";
import { embedFonts } from "../src/lib/fonts";

async function samplePdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) d.addPage([300, 400]).drawText(`Page ${i}`, { x: 20, y: 350, font: f, size: 18 });
  return d.save();
}

const model: DocModel = {
  title: "Quarterly report",
  sections: [
    {
      blocks: [
        { type: "heading", level: 1, text: "Sales summary" },
        { type: "paragraph", text: "Revenue grew in every region. Café costs fell — ünïcödé survives." },
        { type: "list", items: ["North", "South"] },
        { type: "table", rows: [["Region", "Q1", "Q2"], ["North", "120", "140"], ["South", "90", "130"]] }
      ]
    }
  ]
};

describe("page ranges", () => {
  it("parses ranges and open ends", () => {
    expect(parseRanges("1-3, 5, 8-", 9)).toEqual([[0, 1, 2], [4], [7, 8]]);
    expect(() => parseRanges("12", 5)).toThrow();
  });
});

describe("file lock", () => {
  it("round-trips and rejects a wrong password", async () => {
    const data = new TextEncoder().encode("secret spreadsheet");
    const locked = await lockBytes(data, "budget.xlsx", "pa55");
    expect(isLocked(locked)).toBe(true);
    const back = await unlockBytes(locked, "pa55");
    expect(back.name).toBe("budget.xlsx");
    expect(new TextDecoder().decode(back.content)).toBe("secret spreadsheet");
    await expect(unlockBytes(locked, "nope")).rejects.toBeInstanceOf(WrongPassword);
  });
});

describe("PDF operations", () => {
  it("protects and unlocks with a password", async () => {
    const enc = await encryptPdf(await samplePdf(2), "open-me", "", { print: true, copy: false, modify: false });
    const plain = await PDFDocument.load(enc, { ignoreEncryption: true });
    expect(plain.isEncrypted).toBe(true);
    let asked = 0;
    const opened = await openPdf({ name: "x.pdf", bytes: enc }, async (_n, wrong) => (asked++, wrong ? "open-me" : "bad"));
    expect(asked).toBe(2);
    expect(opened.doc.getPageCount()).toBe(2);
  });

  it("merges, splits and reorganizes", async () => {
    const a = await PDFDocument.load(await samplePdf(2));
    const b = await PDFDocument.load(await samplePdf(3));
    const merged = await PDFDocument.load(await mergePdfs([a, b]));
    expect(merged.getPageCount()).toBe(5);
    const parts = await splitPdf(merged, everyN(5, 2), "m.pdf");
    expect(parts.map((p) => p.name)).toEqual(["m (pages 1-2).pdf", "m (pages 3-4).pdf", "m (page 5).pdf"]);
    const plan = await PDFDocument.load(
      await buildFromPlan([a, b], [{ src: 1, page: 2, rotate: 90 }, { src: -1, page: 0, rotate: 0 }, { src: 0, page: 0, rotate: 0 }])
    );
    expect(plan.getPageCount()).toBe(3);
    expect(plan.getPage(0).getRotation().angle).toBe(90);
  });

  it("repairs a file with a broken cross-reference table", async () => {
    const d = await PDFDocument.create();
    d.addPage().drawText("hello");
    d.addPage();
    const good = await d.save({ useObjectStreams: false });
    const broken = new TextEncoder().encode(
      new TextDecoder("latin1").decode(good).replace(/startxref\s+\d+/, "startxref\n99999")
    );
    const res = await repairPdf(new Uint8Array(Array.from(broken)), () => {});
    expect(res.pages).toBe(2);
  });
});

describe("conversions", () => {
  it("Word round-trip keeps headings, lists and tables", async () => {
    const back = await readDocx(await writeDocx(model), "r");
    const types = back.sections[0].blocks.map((b) => b.type);
    expect(types).toEqual(["heading", "paragraph", "list", "table"]);
    const table = back.sections[0].blocks[3];
    expect(table.type === "table" && table.rows[2]).toEqual(["South", "90", "130"]);
  });

  it("Excel round-trip keeps table cells", async () => {
    const back = await readXlsx(await writeXlsx(model), "r");
    const rows = (back.sections[0].blocks[0] as any).rows as string[][];
    expect(rows[0][0]).toBe("Sales summary");
    expect(rows).toContainEqual(["Region", "Q1", "Q2"]);
    expect(rows).toContainEqual(["North", "120", "140"]);
  });

  it("PowerPoint round-trip keeps titles, bullets and tables", async () => {
    const back = await readPptx(await writePptx(model), "r");
    const all = back.sections.flatMap((s) => s.blocks);
    expect(all.find((b) => b.type === "heading")).toMatchObject({ text: "Sales summary" });
    expect(all.some((b) => b.type === "table" && b.rows[1][0] === "North")).toBe(true);
  });

  it("PDF writer output reads back as text with a table", async () => {
    const back = await readPdf(await writePdf(model), "r", { mode: "text" });
    const blocks = back.sections[0].blocks;
    expect(blocks[0]).toMatchObject({ type: "heading", text: "Sales summary" });
    const table = blocks.find((b) => b.type === "table");
    expect(table && table.type === "table" && table.rows).toContainEqual(["North", "120", "140"]);
    expect(JSON.stringify(blocks)).toContain("ünïcödé");
  });

  it("OCR text layer is searchable", async () => {
    const d = await PDFDocument.create();
    const page = d.addPage([600, 800]);
    const font = (await embedFonts(d)).regular;
    addTextLayer(page, font, {
      text: "Invoice 42",
      width: 1200,
      height: 1600,
      words: [
        { text: "Invoice", x0: 100, y0: 100, x1: 300, y1: 140 },
        { text: "42", x0: 320, y0: 100, x1: 380, y1: 140 }
      ]
    });
    const text = await extractText(await d.save());
    expect(text).toContain("Invoice");
    expect(text).toContain("42");
  });
});
