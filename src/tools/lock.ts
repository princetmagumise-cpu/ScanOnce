import type { Tool } from "./types";
import { h, dropZone, results, run, field, segmented, toast, formatList } from "../ui";
import { makeFile, readBytes } from "../lib/files";
import { lockBytes, unlockBytes, isLocked } from "../lib/vault";

export const lockTool: Tool = {
  id: "lock",
  title: "Lock any file",
  blurb: "Password-lock Word, Excel, PowerPoint, photos or any file.",
  group: "Security",
  icon: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.4 12.6 20 3m-3.5 3.5L19 9m-5-.5 2 2"/>',
  tint: "#636366",
  render(root) {
    let mode: "lock" | "unlock" = "lock";
    let files: File[] = [];
    const out = h("div");
    const body = h("div", { class: "stack" });
    const pw = h("input", { class: "input", type: "password", autocomplete: "new-password" });
    const pw2 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
    const upw = h("input", { class: "input", type: "password", autocomplete: "current-password" });

    const draw = () => {
      out.replaceChildren();
      const picked = files.length ? formatList(files) : null;
      body.replaceChildren(
        ...(mode === "lock"
          ? [
              // Originals aren't copied into the library: that would defeat locking them.
              dropZone({ accept: "*/*", multiple: true, remember: false, label: "Choose files to lock", onFiles: (fs) => { files = fs; draw(); } }),
              picked,
              field("Password", pw, "At least 6 characters. There's no way to recover a forgotten password."),
              field("Confirm password", pw2),
              h("button", { class: "btn primary big", onclick: lock }, "Lock")
            ]
          : [
              dropZone({ accept: ".locked", multiple: true, label: "Choose .locked files", onFiles: (fs) => { files = fs; draw(); } }),
              picked,
              field("Password", upw),
              h("button", { class: "btn primary big", onclick: unlock }, "Unlock")
            ]).filter((x): x is HTMLElement => !!x)
      );
    };

    const lock = () => {
      if (!files.length) return toast("Choose at least one file first.", "error");
      if (pw.value.length < 6) return toast("Use a password of at least 6 characters.", "error");
      if (pw.value !== pw2.value) return toast("The passwords don't match.", "error");
      run("Locking…", async () => {
        const outs: File[] = [];
        for (const f of files) outs.push(makeFile(await lockBytes(await readBytes(f), f.name, pw.value), `${f.name}.locked`));
        results(out, outs, "Encrypted with AES-256. Open .locked files with ScanOnce → Lock any file → Unlock. For PDFs that others must open in any app, use Protect PDF instead.");
      });
    };

    const unlock = () => {
      if (!files.length) return toast("Choose a .locked file first.", "error");
      if (!upw.value) return toast("Type the password first.", "error");
      run("Unlocking…", async () => {
        const outs: File[] = [];
        for (const f of files) {
          const bytes = await readBytes(f);
          if (!isLocked(bytes)) throw new Error(`"${f.name}" isn't a ScanOnce locked file.`);
          const { name, content } = await unlockBytes(bytes, upw.value);
          outs.push(makeFile(content, name));
        }
        // Unlocked originals are handed back, not stored in the library.
        results(out, outs, undefined, { save: false });
      });
    };

    root.append(
      h("section", { class: "card" },
        segmented("lmode", [["lock", "Lock"], ["unlock", "Unlock"]], mode, (v) => { mode = v; files = []; draw(); }),
        body
      ),
      out
    );
    draw();
  }
};
