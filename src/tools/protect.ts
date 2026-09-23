import type { Tool } from "./types";
import { h, dropZone, results, run, field, segmented, askPassword, toast } from "../ui";
import { makeFile, baseName, readBytes } from "../lib/files";
import { encryptPdf } from "../lib/qpdf";
import { openPdf, unlockBytes } from "../lib/pdfops";
import { PDFDocument } from "pdf-lib";

export const protectTool: Tool = {
  id: "protect",
  title: "Protect PDF",
  blurb: "Add a password to a PDF, or remove one you know.",
  group: "Security",
  icon: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  render(root) {
    let mode: "add" | "remove" = "add";
    const out = h("div");
    const body = h("div");
    const pw = h("input", { class: "input", type: "password", autocomplete: "new-password" });
    const pw2 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
    const owner = h("input", { class: "input", type: "password", autocomplete: "new-password" });
    const perms = { print: true, copy: false, modify: false };
    const check = (label: string, key: keyof typeof perms) =>
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: perms[key], onchange: (e: Event) => (perms[key] = (e.target as HTMLInputElement).checked) }), h("span", {}, label));

    const draw = () => {
      out.replaceChildren();
      if (mode === "add") {
        body.replaceChildren(
          dropZone({ accept: ".pdf,application/pdf", multiple: true, label: "Choose PDFs to protect", onFiles: add }),
          field("Password", pw, "Needed to open the PDF. Use at least 6 characters."),
          field("Confirm password", pw2),
          h("details", {},
            h("summary", {}, "Permissions (optional)"),
            h("p", { class: "muted small" }, "Limits what people can do after opening. Most PDF apps respect these, but they aren't as strong as the password itself."),
            check("Allow printing", "print"), check("Allow copying text", "copy"), check("Allow editing", "modify"),
            field("Permissions password", owner, "Lets you change these later. Leave empty to generate one.")
          )
        );
      } else {
        body.replaceChildren(dropZone({ accept: ".pdf,application/pdf", label: "Choose a protected PDF", hint: "You'll need its password", onFiles: ([f]) => remove(f) }));
      }
    };

    const add = (files: File[]) => {
      if (pw.value.length < 6) return toast("Type a password of at least 6 characters first.", "error");
      if (pw.value !== pw2.value) return toast("The passwords don't match.", "error");
      run("Protecting…", async () => {
        const outs: File[] = [];
        for (const f of files) {
          const { bytes } = await openPdf(f, askPassword);
          outs.push(makeFile(await encryptPdf(bytes, pw.value, owner.value, perms), `${baseName(f.name)} (protected).pdf`));
        }
        results(out, outs, "Protected with 256-bit AES. Keep your password safe: it can't be recovered.");
      });
    };

    const remove = (f: File) =>
      run("Unlocking…", async () => {
        const bytes = await readBytes(f);
        const probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        if (!probe.isEncrypted) throw new Error("This PDF doesn't have a password.");
        const plain = await unlockBytes(f.name, bytes, askPassword);
        results(out, [makeFile(plain, `${baseName(f.name)} (unlocked).pdf`)]);
      });

    root.append(
      h("section", { class: "card" },
        segmented("pmode", [["add", "Add password"], ["remove", "Remove password"]], mode, (v) => { mode = v; draw(); }),
        body
      ),
      out
    );
    draw();
  }
};
