import type { Tool } from "./types";
import { h, fill, dropZone, results, run, segmented, field, askPassword } from "../ui";
import { parseRanges, makeFile, baseName } from "../lib/files";
import { openPdf, splitPdf, everyN, pagesToPdf, type OpenedPdf } from "../lib/pdfops";

type Mode = "each" | "every" | "ranges" | "extract";

export const splitTool: Tool = {
  id: "split",
  title: "Split PDF",
  blurb: "Split into single pages, equal parts or custom page ranges.",
  group: "Organize",
  icon: '<path d="M6 3v7a4 4 0 0 0 4 4h0M18 3v7a4 4 0 0 1-4 4h0M12 14v7"/>',
  render(root) {
    let pdf: OpenedPdf | null = null;
    let mode: Mode = "each";
    const out = h("div");
    const opts = h("section", { class: "card", hidden: true });
    const nInput = h("input", { class: "input", type: "number", min: 1, value: 2, inputmode: "numeric" });
    const rangeInput = h("input", { class: "input", placeholder: "e.g. 1-3, 4-6, 7-", inputmode: "text" });
    const pickInput = h("input", { class: "input", placeholder: "e.g. 1, 3, 5-8", inputmode: "text" });

    const draw = () => {
      if (!pdf) return;
      const count = pdf.doc.getPageCount();
      opts.hidden = false;
      fill(opts,
        h("p", {}, h("strong", {}, pdf.name), h("span", { class: "muted" }, ` · ${count} page${count === 1 ? "" : "s"}`)),
        field("How to split", segmented("mode", [["each", "Every page"], ["every", "Every N pages"], ["ranges", "Custom ranges"], ["extract", "Pick pages"]], mode, (v) => { mode = v; draw(); })),
        mode === "every" ? field("Pages per file", nInput) : null,
        mode === "ranges" ? field("Ranges", rangeInput, "Each range becomes its own PDF.") : null,
        mode === "extract" ? field("Pages to keep", pickInput, "The chosen pages go into one new PDF.") : null,
        h("button", { class: "btn primary big", onclick: go }, "Split")
      );
    };

    const go = () =>
      run("Splitting…", async () => {
        const src = pdf!;
        const count = src.doc.getPageCount();
        if (mode === "extract") {
          const pages = parseRanges(pickInput.value, count).flat();
          return results(out, [makeFile(await pagesToPdf(src.doc, pages), `${baseName(src.name)} (selected pages).pdf`)]);
        }
        const groups =
          mode === "each" ? everyN(count, 1)
          : mode === "every" ? everyN(count, Math.max(1, Math.floor(Number(nInput.value) || 1)))
          : parseRanges(rangeInput.value, count);
        results(out, await splitPdf(src.doc, groups, src.name));
      });

    root.append(
      h("section", { class: "card" }, dropZone({ accept: ".pdf,application/pdf", label: "Choose a PDF to split", onFiles: ([f]) =>
        run("Opening…", async () => { pdf = await openPdf(f, askPassword); out.replaceChildren(); draw(); }) })),
      opts,
      out
    );
  }
};
