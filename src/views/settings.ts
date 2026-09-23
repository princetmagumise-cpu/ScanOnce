import { h, field, toast, confirmDanger } from "../ui";
import { formatSize } from "../lib/files";
import * as lib from "../lib/library";
import { getSettings, setSetting } from "../lib/settings";
import { LANGUAGES } from "../lib/languages";

function select<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void) {
  const s = h("select", { class: "input", onchange: () => onChange(s.value as T) },
    ...options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
  return s;
}

function toggle(label: string, detail: string, value: boolean, onChange: (v: boolean) => void) {
  const input = h("input", { type: "checkbox", role: "switch", class: "switch", checked: value, onchange: () => onChange(input.checked) });
  return h("label", { class: "setting-row" }, h("span", { class: "row-text" }, h("span", {}, label), h("span", { class: "muted small" }, detail)), input);
}

export async function renderSettings(root: HTMLElement) {
  const s = getSettings();
  const usage = h("span", { class: "muted" }, "…");
  const refreshUsage = async () => {
    const n = (await lib.listFiles()).length;
    usage.textContent = `${n} file${n === 1 ? "" : "s"}, ${formatSize(await lib.usedBytes())}`;
  };
  refreshUsage();

  root.append(
    h("header", { class: "page-head" }, h("h1", {}, "Settings")),
    h("section", { class: "card" },
      h("h2", { class: "card-title" }, "Files"),
      toggle("Save results to Files", "Keep every PDF and document you create in the Files tab.", s.saveToLibrary, (v) => setSetting("saveToLibrary", v)),
      h("div", { class: "setting-row" }, h("span", {}, "Stored on this device"), usage),
      h("button", { class: "btn danger-btn", onclick: async () => {
        if (await confirmDanger("Delete all files?", "Every file and folder in ScanOnce will be removed from this device. This can't be undone.", "Delete all")) {
          await lib.clearLibrary();
          refreshUsage();
          toast("All files deleted");
        }
      } }, "Delete all files")
    ),
    h("section", { class: "card" },
      h("h2", { class: "card-title" }, "Scanning"),
      toggle("Auto capture", "Takes the picture after the camera holds still for 3 seconds.", s.autoCapture, (v) => setSetting("autoCapture", v)),
      field("Page size", select(s.pageSize, [["a4", "A4"], ["letter", "Letter"], ["fit", "Fit to photo"]], (v) => setSetting("pageSize", v))),
      field("Colour", select(s.scanFilter, [["enhance", "Auto"], ["original", "Original"], ["gray", "Grayscale"], ["bw", "Black & white"]], (v) => setSetting("scanFilter", v))),
      field("Text language (OCR)", select(s.ocrLang, LANGUAGES as [string, string][], (v) => setSetting("ocrLang", v)))
    ),
    h("section", { class: "card" },
      h("h2", { class: "card-title" }, "Install"),
      h("p", { class: "muted" }, h("strong", {}, "iPhone: "), "open ScanOnce in Safari → Share → Add to Home Screen."),
      h("p", { class: "muted" }, h("strong", {}, "Windows: "), "open it in Edge or Chrome → Install app (icon in the address bar).")
    ),
    h("section", { class: "card" },
      h("h2", { class: "card-title" }, "About"),
      h("p", { class: "muted" }, "ScanOnce 1.1. Scanning, converting and every other tool run on this device. Your files are never uploaded. OCR downloads its language data once, then works offline.")
    )
  );
}
