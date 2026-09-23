import { h, icon, toast, promptText, confirmDanger, sheet, row, run } from "../ui";
import { I } from "../icons";
import { formatSize } from "../lib/files";
import * as lib from "../lib/library";
import { addSheet, nextStepSheet } from "../sheets";
import { fileRow } from "./home";

export async function renderFiles(root: HTMLElement, folderId: string | null) {
  const [folders, files] = await Promise.all([lib.listFolders(), lib.listFiles()]);
  const here = folderId ? folders.find((f) => f.id === folderId) : null;
  if (folderId && !here) { location.hash = "#/files"; return; }

  const subfolders = folders.filter((f) => f.parentId === folderId);
  const inHere = files.filter((f) => f.folderId === folderId).sort((a, b) => b.used - a.used);
  const list = h("div", { class: "file-list" });
  const search = h("input", { class: "input search", type: "search", placeholder: `Search ${here ? here.name : "Files"}`, "aria-label": "Search files" });

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    // Searching looks through every folder, not just this one.
    const shownFiles = q ? files.filter((f) => f.name.toLowerCase().includes(q)).sort((a, b) => b.used - a.used) : inHere;
    const shownFolders = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : subfolders;
    list.replaceChildren(
      ...shownFolders.map((f) => {
        const count = files.filter((x) => x.folderId === f.id).length;
        return h("div", { class: "file-row folder" },
          h("a", { class: "folder-link", href: `#/files/${f.id}` },
            h("span", { class: "folder-icon" }, icon(I.files, 22)),
            h("span", { class: "row-text" }, h("span", { class: "fname" }, f.name), h("span", { class: "muted small" }, `${count} item${count === 1 ? "" : "s"}`))
          ),
          h("button", { class: "icon-btn", "aria-label": `Options for ${f.name}`, onclick: () => folderSheet(f) }, icon(I.more, 20))
        );
      }),
      ...shownFiles.map(fileRow)
    );
    if (!list.children.length) {
      list.append(h("div", { class: "empty" },
        h("strong", {}, q ? "No matches" : here ? "This folder is empty" : "No files yet"),
        h("span", { class: "muted" }, q ? "Try a different name." : "Tap ＋ to scan or add documents. Everything you create is saved here too.")
      ));
    }
  };
  search.addEventListener("input", draw);

  const browse = () => {
    const input = h("input", { type: "file", multiple: true, hidden: true });
    input.addEventListener("change", () => {
      const picked = Array.from(input.files ?? []);
      input.remove();
      if (picked.length) run("Adding…", async () => { await Promise.all(picked.map((f) => lib.addFile(f, folderId))); nextStepSheet(picked); });
    });
    document.body.append(input);
    input.click();
  };

  const parent = here?.parentId ? folders.find((f) => f.id === here.parentId) : null;
  const used = files.reduce((n, f) => n + f.size, 0);
  root.append(
    here
      ? h("header", { class: "bar" },
          h("a", { class: "back", href: parent ? `#/files/${parent.id}` : "#/files" }, icon(I.back, 22), h("span", {}, parent ? parent.name : "Files")),
          h("h1", {}, here.name))
      : h("header", { class: "page-head" }, h("h1", {}, "Files")),
    h("div", { class: "toolbar" },
      search,
      h("button", { class: "btn", onclick: async () => {
        const name = await promptText("New folder", "", "Create");
        if (name) await lib.createFolder(name, folderId);
      } }, icon(I.folderPlus, 18), h("span", { class: "hide-compact" }, "New folder")),
      h("button", { class: "btn", onclick: browse }, icon(I.download, 18), h("span", { class: "hide-compact" }, "Import"))
    ),
    list,
    h("p", { class: "muted small foot" },
      `${files.length} file${files.length === 1 ? "" : "s"} · ${formatSize(used)} stored in ScanOnce on this device. `,
      "To browse your phone's own storage, use ＋ → Files; to put a file back, open it and choose Share → Save to Files."
    )
  );
  draw();
  void addSheet;
}

function folderSheet(f: lib.LibFolder) {
  const s = sheet(f.name, [
    h("div", { class: "list" },
      row({ icon: I.rename, title: "Rename", onclick: async () => {
        s.close();
        const name = await promptText("Rename folder", f.name, "Rename");
        if (name) await lib.renameFolder(f.id, name);
      } }),
      row({ icon: I.trash, title: "Delete folder", danger: true, onclick: async () => {
        s.close();
        if (await confirmDanger("Delete folder?", `"${f.name}" and everything in it will be removed from ScanOnce.`, "Delete")) {
          await lib.deleteFolder(f.id);
          toast("Folder deleted");
        }
      } })
    )
  ]);
}
