import { h, sheet, row, handOff, badge, toast, download, share, canShare, promptText, confirmDanger, run } from "./ui";
import { I } from "./icons";
import { kindOf, formatSize } from "./lib/files";
import * as lib from "./lib/library";
import { toolsFor } from "./tools";

/** Opens a tool with files ready to go. */
export function openInTool(toolId: string, files: File[]) {
  handOff(files);
  location.hash = `#/tools/${toolId}`;
}

/** Hidden file input clicked synchronously from a tap, as iOS requires. */
function pick(accept: string, capture: boolean, onFiles: (f: File[]) => void) {
  const input = h("input", { type: "file", accept, multiple: !capture, hidden: true });
  if (capture) input.setAttribute("capture", "environment");
  input.addEventListener("change", () => {
    if (input.files?.length) onFiles(Array.from(input.files));
    input.remove();
  });
  document.body.append(input);
  input.click();
}

/** The ＋ sheet: every way to bring a document into the app, in one place. */
export function addSheet(folderId: string | null = null) {
  const added = (files: File[]) =>
    run("Adding…", async () => {
      await Promise.all(files.map((f) => lib.addFile(f, folderId)));
      nextStepSheet(files);
    });
  const s = sheet("Add", [
    h("div", { class: "list" },
      row({ icon: I.scan, title: "Scan document", detail: "Camera with automatic page detection", onclick: () => { s.close(); location.hash = "#/tools/scan?camera"; } }),
      row({ icon: I.camera, title: "Take photo", detail: "Use the camera app", onclick: () => { s.close(); pick("image/*", true, added); } }),
      row({ icon: I.photo, title: "Photo library", detail: "Pictures and screenshots", onclick: () => { s.close(); pick("image/*", false, added); } }),
      row({ icon: I.files, title: "Files", detail: "PDF, Word, Excel, PowerPoint… from Files or iCloud Drive", onclick: () => { s.close(); pick("", false, added); } })
    )
  ]);
}

/** After adding files: suggest what to do next, based on what they are. */
export function nextStepSheet(files: File[]) {
  const kinds = new Set(files.map((f) => kindOf(f)));
  const kind = kinds.size === 1 ? [...kinds][0] : "unknown";
  const tools = kinds.size === 1 ? toolsFor(kind) : toolsFor("unknown");
  const title = files.length === 1 ? files[0].name : `${files.length} files added`;
  const s = sheet(title, [
    h("p", { class: "muted small sheet-note" }, "Saved in Files. What would you like to do?"),
    h("div", { class: "list" },
      ...tools.map((t) => row({ icon: t.icon, title: t.title, detail: t.blurb, onclick: () => { s.close(); openInTool(t.id, files); } }))
    ),
    h("button", { class: "btn big", onclick: () => { s.close(); location.hash = "#/files"; } }, "Just keep it in Files")
  ]);
}

/** Actions for one file in the library. */
export async function fileSheet(meta: lib.LibFile) {
  const file = await lib.getFile(meta.id);
  if (!file) return toast("This file is no longer available.", "error");
  const tools = toolsFor(kindOf(file));
  const s = sheet(meta.name, [
    h("div", { class: "file-head" }, badge(meta.name, meta.type), h("span", { class: "muted small" }, `${formatSize(meta.size)} · added ${new Date(meta.created).toLocaleDateString()}`)),
    h("h4", { class: "list-label" }, "Open with"),
    h("div", { class: "list" }, ...tools.map((t) => row({ icon: t.icon, title: t.title, onclick: () => { s.close(); lib.touch(meta.id); openInTool(t.id, [file]); } }))),
    h("div", { class: "list" }, ...[
      canShare([file]) ? row({ icon: I.share, title: "Share or save to Files", onclick: () => share([file]) }) : null,
      row({ icon: I.download, title: "Download", onclick: () => download(file) }),
      row({ icon: I.rename, title: "Rename", onclick: async () => {
        s.close();
        const name = await promptText("Rename", meta.name, "Rename");
        if (name) await lib.renameFile(meta.id, name);
      } }),
      row({ icon: I.move, title: "Move to folder", onclick: async () => { s.close(); moveSheet(meta); } }),
      row({ icon: I.trash, title: "Delete", danger: true, onclick: async () => {
        s.close();
        if (await confirmDanger("Delete file?", `"${meta.name}" will be removed from ScanOnce. Copies you saved elsewhere aren't affected.`, "Delete")) {
          await lib.deleteFile(meta.id);
          toast("Deleted");
        }
      } })
    ].filter((x): x is HTMLElement => !!x))
  ]);
}

async function moveSheet(meta: lib.LibFile) {
  const folders = await lib.listFolders();
  const s = sheet("Move to", [
    h("div", { class: "list" },
      row({ icon: I.files, title: "Files (top level)", detail: meta.folderId === null ? "Current location" : undefined, onclick: async () => { s.close(); await lib.moveFile(meta.id, null); } }),
      ...folders.map((f) => row({ icon: I.files, title: f.name, detail: meta.folderId === f.id ? "Current location" : undefined, onclick: async () => { s.close(); await lib.moveFile(meta.id, f.id); } })),
      row({ icon: I.folderPlus, title: "New folder…", onclick: async () => {
        s.close();
        const name = await promptText("New folder", "", "Create");
        if (name) { const f = await lib.createFolder(name); await lib.moveFile(meta.id, f.id); }
      } })
    )
  ]);
}
