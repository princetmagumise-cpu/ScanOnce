import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { h, icon } from "./ui";
import type { Tool } from "./tools/types";
import { scanTool } from "./tools/scan";
import { convertTool } from "./tools/convert";
import { mergeTool } from "./tools/merge";
import { splitTool } from "./tools/split";
import { organizeTool } from "./tools/organize";
import { extractTool } from "./tools/extract";
import { compressTool } from "./tools/compress";
import { ocrTool } from "./tools/ocr";
import { repairTool } from "./tools/repair";
import { protectTool } from "./tools/protect";
import { lockTool } from "./tools/lock";

const TOOLS: Tool[] = [
  scanTool, convertTool,
  mergeTool, splitTool, organizeTool, extractTool,
  compressTool, ocrTool, repairTool,
  protectTool, lockTool
];
const GROUPS: Tool["group"][] = ["Scan & create", "Convert", "Organize", "Optimize & fix", "Security"];

const app = document.getElementById("app")!;

function home() {
  document.title = "ScanOnce";
  app.replaceChildren(
    h("header", { class: "hero" },
      h("h1", {}, "ScanOnce"),
      h("p", {}, "Scan, convert and fix documents. Your files stay on this device and are never uploaded.")
    ),
    ...GROUPS.map((g) =>
      h("section", { class: "group" },
        h("h2", {}, g),
        h("div", { class: "tools" },
          ...TOOLS.filter((t) => t.group === g).map((t) =>
            h("a", { class: "tool", href: `#/${t.id}` },
              h("span", { class: "tool-icon" }, icon(t.icon, 24)),
              h("span", { class: "tool-text" }, h("strong", {}, t.title), h("span", {}, t.blurb))
            )
          )
        )
      )
    ),
    h("footer", { class: "foot muted small" }, "Works offline after the first visit. Install it: iPhone Safari → Share → Add to Home Screen. Windows Edge/Chrome → Install app.")
  );
}

function show(tool: Tool) {
  document.title = `${tool.title} · ScanOnce`;
  const body = h("div", { class: "tool-body" });
  app.replaceChildren(
    h("header", { class: "bar" },
      h("a", { class: "back", href: "#/", "aria-label": "All tools" }, icon('<path d="m15 18-6-6 6-6"/>', 22), h("span", {}, "Tools")),
      h("h1", {}, tool.title)
    ),
    h("p", { class: "lead muted" }, tool.blurb),
    body
  );
  tool.render(body);
}

function route() {
  const id = location.hash.replace(/^#\/?/, "");
  const tool = TOOLS.find((t) => t.id === id);
  if (tool) show(tool);
  else home();
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
registerSW({ immediate: true });
