import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DocModel } from "../docmodel";
import { normalizeRows } from "../docmodel";
import { embedFonts, safeText } from "../fonts";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const ACCENT = rgb(0.06, 0.36, 0.33);
const GRID = rgb(0.6, 0.6, 0.6);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= width) {
        line = trial;
        continue;
      }
      if (line) out.push(line);
      // Break words that are longer than a whole line.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let k = w.length - 1;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

export async function writePdf(doc: DocModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setProducer("ScanOnce");
  const fonts = await embedFonts(pdf);

  for (const section of doc.sections) {
    const [pw, ph] = section.landscape ? [A4[1], A4[0]] : A4;

    // A section that is one picture (a scanned or "exact look" page) fills its page.
    if (section.blocks.length === 1 && section.blocks[0].type === "image") {
      const b = section.blocks[0];
      const img = b.mime === "image/png" ? await pdf.embedPng(b.data) : await pdf.embedJpg(b.data);
      const land = b.width > b.height;
      const [w, h] = land ? [A4[1], A4[0]] : A4;
      const page = pdf.addPage([w, h]);
      const s = Math.min(w / b.width, h / b.height);
      page.drawImage(img, { x: (w - b.width * s) / 2, y: (h - b.height * s) / 2, width: b.width * s, height: b.height * s });
      continue;
    }

    const width = pw - 2 * MARGIN;
    let page: PDFPage = pdf.addPage([pw, ph]);
    let y = ph - MARGIN;
    const ensure = (h: number) => {
      if (y - h < MARGIN) {
        page = pdf.addPage([pw, ph]);
        y = ph - MARGIN;
      }
    };
    const text = (s: string, x: number, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.1)) =>
      page.drawText(safeText(font, s), { x, y: y - size, size, font, color });
    const lines = (s: string, size: number, font: PDFFont, indent = 0, color?: ReturnType<typeof rgb>) => {
      for (const l of wrap(safeText(font, s), font, size, width - indent)) {
        ensure(size * 1.4);
        text(l, MARGIN + indent, size, font, color);
        y -= size * 1.4;
      }
    };

    if (section.title && !section.blocks.some((b) => b.type === "heading")) {
      lines(section.title, 16, fonts.bold, 0, ACCENT);
      y -= 6;
    }
    for (const b of section.blocks) {
      switch (b.type) {
        case "heading": {
          const size = b.level === 1 ? 20 : b.level === 2 ? 16 : 13;
          y -= 6;
          ensure(size * 2.4); // keep headings with the next line
          lines(b.text, size, fonts.bold, 0, ACCENT);
          y -= 4;
          break;
        }
        case "paragraph":
          lines(b.text, 11, b.bold ? fonts.bold : fonts.regular);
          y -= 7;
          break;
        case "list":
          b.items.forEach((it, i) => {
            const bullet = b.ordered ? `${i + 1}.` : "•";
            ensure(15.4);
            text(bullet, MARGIN + 4, 11, fonts.regular);
            lines(it, 11, fonts.regular, 20);
          });
          y -= 7;
          break;
        case "table": {
          const rows = normalizeRows(b.rows);
          const n = rows[0]?.length ?? 0;
          if (!n) break;
          const size = n > 8 ? 7 : n > 5 ? 8.5 : 10;
          // Column widths follow the longest text in each column, within limits.
          const want = Array.from({ length: n }, (_, c) =>
            Math.min(220, Math.max(28, ...rows.map((r) => fonts.regular.widthOfTextAtSize(safeText(fonts.regular, r[c].slice(0, 80)), size) + 8)))
          );
          const total = want.reduce((a, v) => a + v, 0);
          const colW = want.map((v) => (v / total) * width);
          const pad = 3;
          rows.forEach((r, ri) => {
            const font = ri === 0 ? fonts.bold : fonts.regular;
            const cellLines = r.map((c, ci) => wrap(safeText(font, c), font, size, colW[ci] - pad * 2));
            const rowH = Math.max(1, ...cellLines.map((l) => l.length)) * size * 1.3 + pad * 2;
            ensure(rowH);
            let x = MARGIN;
            if (ri === 0) page.drawRectangle({ x, y: y - rowH, width, height: rowH, color: rgb(0.91, 0.94, 0.93) });
            cellLines.forEach((cl, ci) => {
              page.drawRectangle({ x, y: y - rowH, width: colW[ci], height: rowH, borderColor: GRID, borderWidth: 0.5 });
              cl.forEach((l, li) =>
                page.drawText(l, { x: x + pad, y: y - pad - size - li * size * 1.3 + 1, size, font, color: rgb(0.1, 0.1, 0.1) })
              );
              x += colW[ci];
            });
            y -= rowH;
          });
          y -= 12;
          break;
        }
        case "image": {
          const img = b.mime === "image/png" ? await pdf.embedPng(b.data) : await pdf.embedJpg(b.data);
          const maxH = ph - 2 * MARGIN;
          const s = Math.min(1, width / b.width, maxH / b.height, 0.75); // ~96 dpi → points
          const w = b.width * s, h = b.height * s;
          ensure(h);
          page.drawImage(img, { x: MARGIN + (width - w) / 2, y: y - h, width: w, height: h });
          y -= h + 10;
          break;
        }
      }
    }
  }
  if (!pdf.getPageCount()) pdf.addPage(A4);
  return pdf.save();
}
