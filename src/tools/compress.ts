import type { Tool } from "./types";
import { h, fill, dropZone, results, run, segmented, field, busy, askPassword } from "../ui";
import { formatSize, makeFile, baseName } from "../lib/files";
import { openPdf } from "../lib/pdfops";
import { compressPdf, LEVELS, type Level } from "../lib/compress";

export const compressTool: Tool = {
  id: "compress",
  title: "Compress PDF",
  blurb: "Make PDFs smaller for email and uploads.",
  group: "Optimize & fix",
  icon: '<path d="M4 20l6-6m0 0v5m0-5H5"/><path d="M20 4l-6 6m0 0V5m0 5h5"/>',
  tint: "#34C759",
  render(root) {
    let files: File[] = [];
    let level: Level = "balanced";
    const opts = h("section", { class: "card", hidden: true });
    const out = h("div");
    const hint = h("p", { class: "muted small" }, LEVELS[level].hint);

    const draw = () => {
      opts.hidden = !files.length;
      fill(opts,
        h("ul", { class: "filelist" }, ...files.map((f) => h("li", {}, h("span", { class: "fname" }, f.name), h("span", { class: "muted" }, formatSize(f.size))))),
        field("Compression", segmented("level", (Object.keys(LEVELS) as Level[]).map((k) => [k, LEVELS[k].label]), level, (v) => {
          level = v;
          hint.textContent = LEVELS[v].hint;
        })),
        hint,
        h("button", { class: "btn primary big", onclick: go }, "Compress")
      );
    };

    const go = () =>
      run("Compressing…", async () => {
        const outFiles: File[] = [];
        const notes: string[] = [];
        for (const f of files) {
          const { bytes } = await openPdf(f, askPassword);
          const small = await compressPdf(bytes, level, (m) => busy(`${f.name}: ${m}`));
          const saved = 1 - small.length / f.size;
          notes.push(saved > 0.01
            ? `${f.name}: ${formatSize(f.size)} → ${formatSize(small.length)} (${Math.round(saved * 100)}% smaller)`
            : `${f.name} is already about as small as it can get at this level.`);
          outFiles.push(makeFile(small, `${baseName(f.name)} (compressed).pdf`));
        }
        results(out, outFiles, notes.join(" · "));
      });

    root.append(
      h("section", { class: "card" }, dropZone({ accept: ".pdf,application/pdf", multiple: true, label: "Choose PDFs to compress", onFiles: (fs) => { files = fs; out.replaceChildren(); draw(); } })),
      opts,
      out
    );
  }
};
