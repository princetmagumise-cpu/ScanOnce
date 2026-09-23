import type { Tool } from "./types";
import { h, icon, dropZone, results, run, busy, askPassword, toast } from "../ui";
import { kindOf, formatSize, makeFile, baseName } from "../lib/files";
import { openPdf, mergePdfs, imagesToPdf } from "../lib/pdfops";
import { fileToCanvas, canvasToBytes } from "../lib/image";
import type { PDFDocument } from "pdf-lib";

export const mergeTool: Tool = {
  id: "merge",
  title: "Merge PDFs",
  blurb: "Combine PDFs and images into one PDF, in the order you choose.",
  group: "Organize",
  icon: '<path d="M8 4v6a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v2M16 4v6a4 4 0 0 1-4 4"/>',
  render(root) {
    const files: File[] = [];
    const out = h("div");
    const list = h("ol", { class: "filelist ordered" });
    const opts = h("section", { class: "card", hidden: true },
      list,
      h("div", { class: "row wrap" },
        h("button", { class: "btn primary big", onclick: () => go() }, "Merge"),
        h("button", { class: "btn", onclick: () => { files.length = 0; draw(); } }, "Clear")
      )
    );

    const add = (fs: File[]) => {
      const bad = fs.find((f) => kindOf(f) !== "pdf" && kindOf(f) !== "image");
      if (bad) toast(`"${bad.name}" was skipped. Only PDFs and images can be merged. Convert other files first.`, "error");
      files.push(...fs.filter((f) => f !== bad && (kindOf(f) === "pdf" || kindOf(f) === "image")));
      out.replaceChildren();
      draw();
    };

    const draw = () => {
      opts.hidden = !files.length;
      list.replaceChildren(
        ...files.map((f, i) =>
          h("li", { draggable: true,
            ondragstart: (e: DragEvent) => e.dataTransfer!.setData("text/plain", String(i)),
            ondragover: (e: DragEvent) => e.preventDefault(),
            ondrop: (e: DragEvent) => {
              e.preventDefault();
              const from = Number(e.dataTransfer!.getData("text/plain"));
              const [m] = files.splice(from, 1);
              files.splice(i, 0, m);
              draw();
            } },
            h("span", { class: "fname" }, f.name),
            h("span", { class: "muted" }, formatSize(f.size)),
            h("div", { class: "row tight" },
              h("button", { class: "icon-btn", title: "Move up", disabled: i === 0, onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); } }, icon('<path d="m18 15-6-6-6 6"/>', 18)),
              h("button", { class: "icon-btn", title: "Move down", disabled: i === files.length - 1, onclick: () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; draw(); } }, icon('<path d="m6 9 6 6 6-6"/>', 18)),
              h("button", { class: "icon-btn danger", title: "Remove", onclick: () => { files.splice(i, 1); draw(); } }, icon('<path d="M18 6 6 18M6 6l12 12"/>', 18))
            )
          )
        )
      );
    };

    const go = () =>
      run("Merging…", async () => {
        if (files.length < 2) throw new Error("Add at least two files to merge.");
        const docs: PDFDocument[] = [];
        for (const [i, f] of files.entries()) {
          busy(`Adding ${f.name}…`, i / files.length);
          if (kindOf(f) === "pdf") {
            docs.push((await openPdf(f, askPassword)).doc);
          } else {
            const c = await fileToCanvas(f, 2600);
            docs.push(await imagesToPdf([{ bytes: await canvasToBytes(c, "image/jpeg", 0.85), mime: "image/jpeg", width: c.width, height: c.height }], "a4", 18));
          }
        }
        busy("Saving…");
        results(out, [makeFile(await mergePdfs(docs), `${baseName(files[0].name)} (merged).pdf`)]);
      });

    root.append(
      h("section", { class: "card" }, dropZone({ accept: ".pdf,application/pdf,image/*", multiple: true, label: "Add PDFs or images", hint: "Add as many as you like; drag to reorder", onFiles: add })),
      opts,
      out
    );
  }
};
