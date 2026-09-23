import type { Tool } from "./types";
import { h, fill, dropZone, results, run, field, askPassword, busy } from "../ui";
import { makeFile, baseName, parseRanges } from "../lib/files";
import { openPdf, pagesToPdf, type OpenedPdf } from "../lib/pdfops";
import { extractText, extractImages } from "../lib/extract";

export const extractTool: Tool = {
  id: "extract",
  title: "Extract",
  blurb: "Pull out the text, the images or selected pages of a PDF.",
  group: "Organize",
  icon: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M12 11v6m0 0-3-3m3 3 3-3"/>',
  render(root) {
    let pdf: OpenedPdf | null = null;
    const out = h("div");
    const pages = h("input", { class: "input", placeholder: "e.g. 2-4, 9" });
    const opts = h("section", { class: "card", hidden: true });

    const draw = () => {
      const p = pdf!;
      const stem = baseName(p.name);
      opts.hidden = false;
      fill(opts,
        h("p", {}, h("strong", {}, p.name), h("span", { class: "muted" }, ` · ${p.doc.getPageCount()} pages`)),
        h("div", { class: "choices" },
          h("button", { class: "choice", onclick: () => run("Extracting text…", async () => {
            const text = await extractText(p.bytes);
            const empty = !text.replace(/--- Page \d+ ---/g, "").trim();
            results(out, [makeFile(new TextEncoder().encode(text), `${stem}.txt`)], empty ? "This PDF has no text layer (it's probably scanned). Use OCR PDF to read its text." : undefined);
          }) }, h("strong", {}, "Text"), h("span", { class: "muted small" }, "All text as a .txt file")),
          h("button", { class: "choice", onclick: () => run("Extracting images…", async () => {
            busy("Finding images…");
            const imgs = await extractImages(p.doc, stem);
            if (!imgs.length) throw new Error("No extractable images were found in this PDF.");
            results(out, imgs);
          }) }, h("strong", {}, "Images"), h("span", { class: "muted small" }, "Every picture, at original quality"))
        ),
        field("Pages", pages, "Save just these pages as a new PDF."),
        h("button", { class: "btn", onclick: () => run("Extracting pages…", async () => {
          const idx = parseRanges(pages.value, p.doc.getPageCount()).flat();
          results(out, [makeFile(await pagesToPdf(p.doc, idx), `${stem} (extracted).pdf`)]);
        }) }, "Extract pages")
      );
    };

    root.append(
      h("section", { class: "card" }, dropZone({ accept: ".pdf,application/pdf", label: "Choose a PDF", onFiles: ([f]) =>
        run("Opening…", async () => { pdf = await openPdf(f, askPassword); out.replaceChildren(); draw(); }) })),
      opts,
      out
    );
  }
};
