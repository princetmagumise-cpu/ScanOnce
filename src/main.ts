import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { h, icon, iconFilled } from "./ui";
import { I } from "./icons";
import { toolById } from "./tools";
import { noteToolUsed } from "./lib/settings";
import * as lib from "./lib/library";
import { addSheet } from "./sheets";
import { renderHome } from "./views/home";
import { renderFiles } from "./views/files";
import { renderTools } from "./views/tools";
import { renderSettings } from "./views/settings";

type Tab = "home" | "files" | "tools" | "settings";
const TABS: [Tab, string, string, string][] = [
  ["home", "Home", I.home, I.homeFill],
  ["files", "Files", I.files, I.filesFill],
  ["tools", "Tools", I.tools, I.toolsFill],
  ["settings", "Settings", I.settings, I.settingsFill]
];

const app = document.getElementById("app")!;
let currentFolder: string | null = null;

const tabLinks = TABS.map(([id, label, outline, filled]) => {
  const off = icon(outline, 24);
  const on = iconFilled(filled, 24);
  off.classList.add("off");
  on.classList.add("on");
  return h("a", { class: "tab", href: `#/${id}`, "data-tab": id }, off, on, h("span", {}, label));
});
const newBtn = h("button", { class: "btn primary new-btn", onclick: () => addSheet(currentFolder) }, icon(I.plus, 18), "Add");
const nav = h("nav", { class: "tabbar", "aria-label": "Sections" },
  h("div", { class: "brand" }, h("img", { src: "./icon.svg", alt: "", width: 28, height: 28 }), "ScanOnce"),
  newBtn,
  ...tabLinks
);
const fab = h("button", { class: "fab", "aria-label": "Add: scan, take a photo or choose a file", onclick: () => addSheet(currentFolder) }, icon(I.plus, 28));
document.body.append(nav, fab);

function parse(): { tab: Tab; rest: string } {
  const path = location.hash.replace(/^#\/?/, "").split("?")[0];
  const [first, ...rest] = path.split("/");
  if ((TABS.map((t) => t[0]) as string[]).includes(first)) return { tab: first as Tab, rest: rest.join("/") };
  if (toolById(first)) return { tab: "tools", rest: first }; // old links like #/merge
  return { tab: "home", rest: "" };
}

let renderSeq = 0;
async function route() {
  const seq = ++renderSeq;
  const { tab, rest } = parse();
  const view = h("div", { class: "view" });
  tabLinks.forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const tool = tab === "tools" && rest ? toolById(rest) : undefined;
  fab.hidden = !!tool || tab === "settings";
  currentFolder = tab === "files" && rest ? rest : null;

  if (tool) {
    document.title = `${tool.title} · ScanOnce`;
    noteToolUsed(tool.id);
    const body = h("div", { class: "tool-body" });
    view.append(
      h("header", { class: "bar" },
        h("a", { class: "back", href: "#/tools", "aria-label": "Back to all tools" }, icon(I.back, 22), h("span", {}, "Tools")),
        h("h1", {}, tool.title)
      ),
      h("p", { class: "lead muted" }, tool.blurb),
      body
    );
    app.replaceChildren(view);
    tool.render(body);
  } else {
    document.title = tab === "home" ? "ScanOnce" : `${TABS.find((t) => t[0] === tab)![1]} · ScanOnce`;
    if (tab === "home") await renderHome(view);
    else if (tab === "files") await renderFiles(view, currentFolder);
    else if (tab === "tools") renderTools(view);
    else await renderSettings(view);
    if (seq !== renderSeq) return; // a newer navigation won
    app.replaceChildren(view);
  }
  if (!tool || !location.hash.includes("?")) window.scrollTo(0, 0);
}

// Keep Home and Files current when the library changes; never reset a tool mid-task.
lib.onChange(() => {
  const { tab, rest } = parse();
  if (tab === "home" || (tab === "files") || (tab === "settings")) {
    const y = window.scrollY;
    route().then(() => window.scrollTo(0, y));
  }
  void rest;
});

window.addEventListener("hashchange", route);
route();
registerSW({ immediate: true });
