import type { Tool } from "./types";
import { h, dropZone, results, run, busy } from "../ui";
import { makeFile, baseName, readBytes } from "../lib/files";
import { repairPdf } from "../lib/repair";

export const repairTool: Tool = {
  id: "repair",
  title: "Repair PDF",
  blurb: "Recover damaged or half-downloaded PDFs that won't open.",
  group: "Optimize & fix",
  icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a2.1 2.1 0 0 0 3 3l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4Z"/>',
  tint: "#8E8E93",
  render(root) {
    const out = h("div");
    root.append(
      h("section", { class: "card" }, dropZone({ accept: ".pdf,application/pdf", label: "Choose a damaged PDF", onFiles: ([f]) =>
        run("Repairing…", async () => {
          const res = await repairPdf(await readBytes(f), (m) => busy(m));
          results(out, [makeFile(res.bytes, `${baseName(f.name)} (repaired).pdf`)], `${res.method}. ${res.pages} page${res.pages === 1 ? "" : "s"} recovered.`);
        }) })),
      h("p", { class: "muted small pad" }, "Repair works on the file structure. If a damaged PDF also has a password, results may be limited."),
      out
    );
  }
};
