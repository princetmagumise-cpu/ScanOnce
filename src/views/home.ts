import { h, icon, badge, ago, toolTile } from "../ui";
import { I } from "../icons";
import { formatSize } from "../lib/files";
import * as lib from "../lib/library";
import { recentTools } from "../lib/settings";
import { toolById } from "../tools";
import { fileSheet, addSheet } from "../sheets";

const STARTERS = ["scan", "convert", "compress", "merge"];

export function fileRow(f: lib.LibFile): HTMLElement {
  return h("button", { class: "file-row", onclick: () => fileSheet(f) },
    badge(f.name, f.type),
    h("span", { class: "row-text" }, h("span", { class: "fname" }, f.name), h("span", { class: "muted small" }, `${formatSize(f.size)} · ${ago(f.used)}`)),
    h("span", { class: "more", "aria-hidden": "true" }, icon(I.more, 20))
  );
}

export async function renderHome(root: HTMLElement) {
  const files = await lib.recentFiles(6);
  const used = recentTools().map(toolById).filter(Boolean);
  const tools = used.length ? used.slice(0, 4) : STARTERS.map(toolById);

  root.append(
    h("header", { class: "page-head" }, h("h1", {}, "Home"), h("p", { class: "muted" }, "Everything stays on this device.")),
    h("section", { class: "block" },
      h("div", { class: "row between" }, h("h2", {}, "Recent files"), files.length ? h("a", { class: "see-all", href: "#/files" }, "See all") : null),
      files.length
        ? h("div", { class: "file-list" }, ...files.map(fileRow))
        : h("div", { class: "empty" },
            h("img", { src: "./icon.svg", alt: "", width: 56, height: 56 }),
            h("strong", {}, "No files yet"),
            h("span", { class: "muted" }, "Scan a page or add a document to get started."),
            h("button", { class: "btn primary", onclick: () => addSheet() }, icon(I.plus, 18), "Add")
          )
    ),
    h("section", { class: "block" },
      h("div", { class: "row between" }, h("h2", {}, used.length ? "Recent tools" : "Get started"), h("a", { class: "see-all", href: "#/tools" }, "All tools")),
      h("div", { class: "tool-tiles" },
        ...tools.map((t) =>
          h("a", { class: "tile", href: `#/tools/${t!.id}` }, toolTile(t!), h("strong", {}, t!.title))
        )
      )
    )
  );
}
