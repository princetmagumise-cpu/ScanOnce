import PptxGenJS from "pptxgenjs";
import type { Block, DocModel } from "../docmodel";
import { normalizeRows } from "../docmodel";

const W = 13.333, H = 7.5; // 16:9 in inches
const M = 0.5;
const ACCENT = "0F5B54";

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

type SlideSpec = { title?: string; body: Block[] };

/** Splits a section's content into slides that won't overflow. */
function paginate(title: string | undefined, blocks: Block[]): SlideSpec[] {
  const slides: SlideSpec[] = [];
  let cur: SlideSpec = { title, body: [] };
  let lines = 0;
  const LIMIT = 14;
  const push = () => {
    if (cur.body.length || cur.title) slides.push(cur);
    cur = { title: undefined, body: [] };
    lines = 0;
  };
  for (const b of blocks) {
    if (b.type === "heading") {
      if (b.level === 1 || lines > 0 || cur.title) {
        if (cur.body.length || (cur.title && cur.title !== b.text)) push();
      }
      if (!cur.title) cur.title = b.text;
      else cur.body.push({ type: "paragraph", text: b.text, bold: true });
      continue;
    }
    if (b.type === "image" || b.type === "table") {
      // Images and tables get their own slide (tables in chunks of rows).
      if (cur.body.length) push();
      if (b.type === "table") {
        const rows = normalizeRows(b.rows);
        const header = rows[0];
        for (let i = 1; i < Math.max(2, rows.length); i += 11) {
          slides.push({ title: cur.title ?? title, body: [{ type: "table", rows: [header, ...rows.slice(i, i + 11)] }] });
        }
      } else {
        slides.push({ title: cur.title, body: [b] });
      }
      cur = { title: undefined, body: [] };
      continue;
    }
    const need = b.type === "list" ? b.items.length : Math.ceil(b.text.length / 110);
    if (lines + need > LIMIT && cur.body.length) {
      const t = cur.title;
      push();
      cur.title = t ? `${t} (cont.)` : undefined;
    }
    cur.body.push(b);
    lines += need;
  }
  push();
  return slides;
}

export async function writePptx(doc: DocModel): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = doc.title;
  pptx.author = "ScanOnce";
  // A real title placeholder, so PowerPoint's outline, accessibility checker
  // and slide sorter all see the slide titles.
  pptx.defineSlideMaster({
    title: "SCANONCE",
    background: { color: "FFFFFF" },
    objects: [
      {
        placeholder: {
          options: { name: "title", type: "title", x: M, y: 0.35, w: W - 2 * M, h: 0.9, fontSize: 28, bold: true, color: ACCENT, fontFace: "Calibri", valign: "middle" },
          text: ""
        }
      }
    ]
  });

  for (const section of doc.sections) {
    // A section that is just one picture (e.g. a PDF page) becomes a full-bleed slide.
    const only = section.blocks.length === 1 && section.blocks[0].type === "image" ? section.blocks[0] : null;
    if (only && only.type === "image") {
      const slide = pptx.addSlide();
      const s = Math.min(W / only.width, H / only.height);
      const w = only.width * s, h = only.height * s;
      slide.addImage({ data: `data:${only.mime};base64,${toBase64(only.data)}`, x: (W - w) / 2, y: (H - h) / 2, w, h });
      continue;
    }
    for (const spec of paginate(section.title, section.blocks)) {
      const slide = pptx.addSlide({ masterName: "SCANONCE" });
      let top = M;
      if (spec.title) {
        slide.addText(spec.title, { placeholder: "title" });
        top = 1.35;
      }
      const areaH = H - top - M;
      const img = spec.body.find((b) => b.type === "image");
      const tbl = spec.body.find((b) => b.type === "table");
      if (img && img.type === "image") {
        const s = Math.min((W - 2 * M) / img.width, areaH / img.height);
        const w = img.width * s, h = img.height * s;
        slide.addImage({ data: `data:${img.mime};base64,${toBase64(img.data)}`, x: (W - w) / 2, y: top + (areaH - h) / 2, w, h });
      } else if (tbl && tbl.type === "table") {
        const rows = normalizeRows(tbl.rows).map((r, i) =>
          r.map((c) => ({ text: c, options: i === 0 ? { bold: true, fill: { color: "E8EFEE" } } : {} }))
        );
        slide.addTable(rows, { x: M, y: top, w: W - 2 * M, fontSize: 12, border: { type: "solid", pt: 0.5, color: "999999" }, autoPage: false });
      } else if (spec.body.length) {
        const runs: PptxGenJS.TextProps[] = [];
        for (const b of spec.body) {
          if (b.type === "list") {
            b.items.forEach((t) => runs.push({ text: t, options: { bullet: b.ordered ? { type: "number" } : true, breakLine: true } }));
          } else if (b.type === "paragraph") {
            runs.push({ text: b.text, options: { bold: b.bold, breakLine: true, paraSpaceAfter: 6 } });
          }
        }
        slide.addText(runs, { x: M, y: top, w: W - 2 * M, h: areaH, fontSize: 18, valign: "top", fontFace: "Calibri", fit: "shrink" });
      }
    }
  }
  if (!(pptx as any).slides?.length) pptx.addSlide();
  const out = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return out;
}
