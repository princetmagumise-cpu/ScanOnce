import type { Tool } from "./types";
import { h, dropZone, results, run, field, busy, askPassword, toast } from "../ui";
import { kindOf, makeFile, baseName } from "../lib/files";
import { openPdf } from "../lib/pdfops";
import { LANGUAGES } from "../lib/languages";

export const ocrTool: Tool = {
  id: "ocr",
  title: "OCR PDF",
  blurb: "Turn scans and photos into searchable, copyable text.",
  group: "Optimize & fix",
  icon: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  render(root) {
    let files: File[] = [];
    const out = h("div");
    const sel = h("select", { class: "input" }, ...LANGUAGES.map(([v, l]) => h("option", { value: v }, l)));
    const second = h("select", { class: "input" }, h("option", { value: "" }, "None"), ...LANGUAGES.map(([v, l]) => h("option", { value: v }, l)));
    const list = h("ul", { class: "filelist" });
    const opts = h("section", { class: "card", hidden: true },
      list,
      field("Document language", sel),
      field("Second language (optional)", second, "Language data downloads once (needs internet the first time), then works offline."),
      h("button", { class: "btn primary big", onclick: () => go() }, "Make searchable")
    );

    const setFiles = (fs: File[]) => {
      const kinds = new Set(fs.map((f) => kindOf(f)));
      if ([...kinds].some((k) => k !== "pdf" && k !== "image") || kinds.size > 1) {
        return toast("Choose one PDF, or one or more images.", "error");
      }
      files = kinds.has("pdf") ? fs.slice(0, 1) : fs;
      list.replaceChildren(...files.map((f) => h("li", {}, h("span", { class: "fname" }, f.name))));
      opts.hidden = false;
      out.replaceChildren();
    };

    const go = () =>
      run("Starting OCR…", async () => {
        const { ocrPdf, ocrImages } = await import("../lib/ocr");
        const langs = [sel.value, second.value].filter((v, i, a) => v && a.indexOf(v) === i).join("+");
        const progress = (m: string, f: number) => busy(m, f);
        const stem = baseName(files[0].name);
        const res = kindOf(files[0]) === "pdf"
          ? await ocrPdf((await openPdf(files[0], askPassword)).bytes, langs, progress)
          : await ocrImages(files, langs, progress);
        results(out, [
          makeFile(res.pdf, `${stem} (searchable).pdf`),
          makeFile(new TextEncoder().encode(res.text), `${stem} (text).txt`)
        ], res.text.trim() ? undefined : "No text was recognised. Check the language, or try a sharper scan.");
      });

    root.append(
      h("section", { class: "card" }, dropZone({ accept: ".pdf,application/pdf,image/*", multiple: true, label: "Choose a scanned PDF or photos", onFiles: setFiles })),
      opts,
      out
    );
  }
};
