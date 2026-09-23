import type { Tool } from "./types";
import { h, fill, dropZone, results, run, segmented, field, busy, askPassword, toast } from "../ui";
import { kindOf, formatSize, readBytes, baseName, type Kind } from "../lib/files";
import { readAny, writeAny, targetsFor, combine, TARGET_LABEL, type Target } from "../lib/convert";
import { openPdf } from "../lib/pdfops";

const KIND_LABEL: Partial<Record<Kind, string>> = {
  pdf: "PDF", docx: "Word", xlsx: "Excel", pptx: "PowerPoint", image: "Image", text: "Text"
};

export const convertTool: Tool = {
  id: "convert",
  title: "Convert",
  blurb: "PDF ⇄ Word, Excel, PowerPoint, plus Word ⇄ Excel ⇄ PowerPoint and images.",
  group: "Convert",
  icon: '<path d="M4 8h15m0 0-3.5-3.5M19 8l-3.5 3.5"/><path d="M20 16H5m0 0 3.5-3.5M5 16l3.5 3.5"/>',
  tint: "#5856D6",
  render(root) {
    let files: File[] = [];
    let target: Target | null = null;
    let pdfMode: "text" | "image" = "text";
    const opts = h("section", { class: "card", hidden: true });
    const out = h("div");

    const setFiles = (fs: File[]) => {
      const kinds = new Set(fs.map((f) => kindOf(f)));
      const bad = fs.find((f) => !targetsFor(kindOf(f)).length);
      if (bad) return toast(`"${bad.name}" isn't a file type ScanOnce can convert.`, "error");
      if (kinds.size > 1) return toast("Pick files of one type at a time (for example, all PDFs or all images).", "error");
      files = fs;
      out.replaceChildren();
      draw();
    };

    const draw = () => {
      opts.hidden = !files.length;
      if (!files.length) return;
      const kind = kindOf(files[0]);
      const targets = targetsFor(kind);
      if (!target || !targets.includes(target)) target = targets[0];
      const needsMode = kind === "pdf" && (target === "docx" || target === "xlsx" || target === "pptx");
      if (kind === "pdf") pdfMode = target === "pptx" ? "image" : "text";
      fill(opts,
        h("ul", { class: "filelist" }, ...files.map((f) => h("li", {}, h("span", { class: "fname" }, f.name), h("span", { class: "muted" }, formatSize(f.size))))),
        field(`Convert ${KIND_LABEL[kind]} to`, segmented("target", targets.map((t) => [t, TARGET_LABEL[t]] as [Target, string]), target, (v) => { target = v; draw(); })),
        needsMode
          ? field("Layout", segmented("mode", [["text", "Editable text"], ["image", "Exact look"]], pdfMode, (v) => (pdfMode = v)),
              "Editable text rebuilds paragraphs and tables you can change. Exact look keeps each page as a picture.")
          : null,
        kind === "image" && files.length > 1 ? h("p", { class: "muted small" }, `All ${files.length} images go into one file, in this order.`) : null,
        h("button", { class: "btn primary big", onclick: convert }, "Convert")
      );
    };

    const convert = () =>
      run("Converting…", async () => {
        const kind = kindOf(files[0]);
        const progress = (m: string) => busy(m);
        const t = target!;
        const mode = t === "jpg" ? "image" : t === "txt" ? "text" : pdfMode;
        const outputs: File[] = [];
        let scanned = false;
        if (kind === "image") {
          const docs = [];
          for (const [i, f] of files.entries()) {
            busy(`Reading image ${i + 1} of ${files.length}…`, i / files.length);
            docs.push(await readAny(f, { pdfMode: mode }));
          }
          outputs.push(...(await writeAny(combine(docs, baseName(files[0].name)), t)));
        } else {
          for (const f of files) {
            let input: File | { name: string; bytes: Uint8Array } = f;
            if (kind === "pdf") {
              const opened = await openPdf(f, askPassword);
              input = { name: f.name, bytes: opened.bytes };
            } else {
              input = { name: f.name, bytes: await readBytes(f) };
            }
            busy(`Reading ${f.name}…`);
            const model = await readAny(input, { pdfMode: mode, progress });
            if (kind === "pdf" && mode === "text" && model.sections.some((s) => s.blocks.length === 1 && s.blocks[0].type === "image")) scanned = true;
            busy(`Writing ${TARGET_LABEL[t]}…`);
            outputs.push(...(await writeAny(model, t)));
          }
        }
        if (!outputs.length) throw new Error("Nothing to convert was found in this file.");
        results(out, outputs, scanned ? "Some pages had no text (they look scanned), so they were kept as pictures. Run OCR first to get editable text from them." : undefined);
      });

    root.append(
      h("section", { class: "card" },
        dropZone({ accept: ".pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.csv,image/*", multiple: true, label: "Choose files to convert", hint: "PDF, Word, Excel, PowerPoint, images, text or CSV", onFiles: setFiles })
      ),
      opts,
      out
    );
  }
};
