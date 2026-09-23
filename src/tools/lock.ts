import type { Tool } from "./types";
import { h, dropZone, results, run, field, segmented, toast } from "../ui";
import { makeFile, readBytes } from "../lib/files";
import { lockBytes, unlockBytes, isLocked } from "../lib/vault";

export const lockTool: Tool = {
  id: "lock",
  title: "Lock any file",
  blurb: "Password-lock Word, Excel, PowerPoint, photos or any file.",
  group: "Security",
  icon: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/><path d="M9.5 12.5 11 14l3.5-3.5"/>',
  render(root) {
    let mode: "lock" | "unlock" = "lock";
    const out = h("div");
    const body = h("div");
    const pw = h("input", { class: "input", type: "password", autocomplete: "new-password" });
    const pw2 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
    const upw = h("input", { class: "input", type: "password", autocomplete: "current-password" });

    const draw = () => {
      out.replaceChildren();
      body.replaceChildren(
        ...(mode === "lock"
          ? [
              field("Password", pw, "At least 6 characters. There's no way to recover a forgotten password."),
              field("Confirm password", pw2),
              dropZone({ accept: "*/*", multiple: true, label: "Choose files to lock", onFiles: lock })
            ]
          : [
              field("Password", upw),
              dropZone({ accept: ".locked", multiple: true, label: "Choose .locked files", onFiles: unlock })
            ])
      );
    };

    const lock = (files: File[]) => {
      if (pw.value.length < 6) return toast("Type a password of at least 6 characters first.", "error");
      if (pw.value !== pw2.value) return toast("The passwords don't match.", "error");
      run("Locking…", async () => {
        const outs: File[] = [];
        for (const f of files) outs.push(makeFile(await lockBytes(await readBytes(f), f.name, pw.value), `${f.name}.locked`));
        results(out, outs, "Encrypted with AES-256. Open .locked files with ScanOnce → Lock any file → Unlock. For PDFs that others must open in any app, use Protect PDF instead.");
      });
    };

    const unlock = (files: File[]) => {
      if (!upw.value) return toast("Type the password first.", "error");
      run("Unlocking…", async () => {
        const outs: File[] = [];
        for (const f of files) {
          const bytes = await readBytes(f);
          if (!isLocked(bytes)) throw new Error(`"${f.name}" isn't a ScanOnce locked file.`);
          const { name, content } = await unlockBytes(bytes, upw.value);
          outs.push(makeFile(content, name));
        }
        results(out, outs);
      });
    };

    root.append(
      h("section", { class: "card" },
        segmented("lmode", [["lock", "Lock"], ["unlock", "Unlock"]], mode, (v) => { mode = v; draw(); }),
        body
      ),
      out
    );
    draw();
  }
};
