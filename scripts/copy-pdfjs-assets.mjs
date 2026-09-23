// Copies pdf.js character maps and standard fonts into public/ so PDFs with
// Asian text or non-embedded fonts render correctly, including offline.
import { cpSync } from "node:fs";

for (const dir of ["cmaps", "standard_fonts"]) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
