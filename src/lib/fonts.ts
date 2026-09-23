import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import regularUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import boldUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import { isNode } from "./files";

// PDF's built-in fonts only cover Western European characters. DejaVu Sans
// covers most scripts, so generated PDFs don't lose accented letters,
// Greek, Cyrillic, symbols and so on. Only the glyphs used get embedded.

const cache = new Map<string, Promise<Uint8Array>>();

function load(url: string): Promise<Uint8Array> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      if (isNode) {
        const { readFile } = await import("node:fs/promises");
        return new Uint8Array(await readFile(process.cwd() + url));
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("Could not load font");
      return new Uint8Array(await res.arrayBuffer());
    })();
    cache.set(url, p);
  }
  return p;
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const [r, b] = await Promise.all([load(regularUrl), load(boldUrl)]);
  return {
    regular: await doc.embedFont(r, { subset: true }),
    bold: await doc.embedFont(b, { subset: true })
  };
}

/** Drops characters the font has no glyph for, so drawing never throws. */
const charSets = new WeakMap<PDFFont, Set<number>>();

export function safeText(font: PDFFont, text: string): string {
  let has = charSets.get(font);
  if (!has) {
    has = new Set(font.getCharacterSet());
    charSets.set(font, has);
  }
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 10 || cp === 13) continue;
    out += has.has(cp) ? ch : cp < 32 ? "" : "?";
  }
  return out;
}
