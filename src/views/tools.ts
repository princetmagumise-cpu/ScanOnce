import { h, icon } from "../ui";
import { TOOLS, GROUPS } from "../tools";

export function renderTools(root: HTMLElement) {
  root.append(
    h("header", { class: "page-head" }, h("h1", {}, "Tools")),
    ...GROUPS.map((g) =>
      h("section", { class: "group" },
        h("h2", {}, g),
        h("div", { class: "tools" },
          ...TOOLS.filter((t) => t.group === g).map((t) =>
            h("a", { class: "tool", href: `#/tools/${t.id}` },
              h("span", { class: "tool-icon" }, icon(t.icon, 24)),
              h("span", { class: "tool-text" }, h("strong", {}, t.title), h("span", {}, t.blurb))
            )
          )
        )
      )
    )
  );
}
