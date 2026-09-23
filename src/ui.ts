import { formatSize, zipFiles, kindOf, extOf } from "./lib/files";
import { UserCancelled } from "./lib/pdfops";
import * as lib from "./lib/library";
import { getSettings } from "./lib/settings";

type Attrs = Record<string, unknown> & { class?: string; style?: string };
type Child = Node | string | null | undefined | false;

/** Tiny DOM builder: h("button", { class: "btn", onclick }, "Save"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k in el && typeof v !== "string") (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

export function icon(path: string, size = 22): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = path;
  return svg;
}

/** Solid glyph (for selected tab bar items), filled with the current colour. */
export function iconFilled(path: string, size = 22): SVGSVGElement {
  const svg = icon(path, size);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("fill-rule", "evenodd");
  svg.setAttribute("stroke", "none");
  return svg;
}

/** A tool's icon: white glyph on its colour tile. */
export function toolTile(t: { icon: string; tint: string }, size = 24): HTMLElement {
  const el = h("span", { class: "tool-icon", "aria-hidden": "true" }, icon(t.icon, size));
  el.style.setProperty("--tint", t.tint);
  return el;
}

// ---------- Toasts ----------

export function toast(msg: string, kind: "info" | "error" = "info") {
  const host = document.getElementById("toasts")!;
  const t = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, msg);
  host.append(t);
  setTimeout(() => t.classList.add("gone"), kind === "error" ? 6000 : 3000);
  setTimeout(() => t.remove(), kind === "error" ? 6500 : 3500);
}

// ---------- Busy overlay ----------

let busyEl: HTMLElement | null = null;

export function busy(msg: string, fraction?: number) {
  if (!busyEl) {
    busyEl = h("div", { class: "busy", role: "status", "aria-live": "polite" },
      h("div", { class: "busy-card" }, h("div", { class: "spinner" }), h("p", { class: "busy-msg" }), h("div", { class: "progress" }, h("i")))
    );
    document.body.append(busyEl);
  }
  busyEl.querySelector(".busy-msg")!.textContent = msg;
  const bar = busyEl.querySelector<HTMLElement>(".progress")!;
  bar.style.visibility = fraction === undefined ? "hidden" : "visible";
  if (fraction !== undefined) bar.querySelector<HTMLElement>("i")!.style.width = `${Math.round(fraction * 100)}%`;
}

export function done() {
  busyEl?.remove();
  busyEl = null;
}

/** Runs a task with the busy overlay and turns errors into friendly messages. */
export async function run<T>(msg: string, task: () => Promise<T>): Promise<T | undefined> {
  busy(msg);
  await new Promise((r) => setTimeout(r, 30)); // let the overlay paint
  try {
    return await task();
  } catch (e) {
    if (!(e instanceof UserCancelled)) {
      console.error(e);
      toast((e as Error).message || "Something went wrong", "error");
    }
    return undefined;
  } finally {
    done();
  }
}

// ---------- Dialogs ----------

export function dialog(title: string, body: Node[], actions: { label: string; primary?: boolean; value: string }[]): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dlg" },
      h("form", { method: "dialog" },
        h("h3", {}, title),
        ...body,
        h("div", { class: "row end" },
          ...actions.map((a) => h("button", { class: a.primary ? "btn primary" : "btn", value: a.value }, a.label))
        )
      )
    ) as HTMLDialogElement;
    document.body.append(dlg);
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue || null);
      dlg.remove();
    });
    dlg.showModal();
  });
}

export async function askPassword(fileName: string, wrongBefore: boolean): Promise<string | null> {
  done(); // hide the busy overlay while asking
  const input = h("input", { type: "password", class: "input", autocomplete: "current-password", placeholder: "Password" });
  const res = dialog(
    "Password needed",
    [
      h("p", { class: "muted" }, `"${fileName}" is locked. Enter its password to continue.`),
      wrongBefore ? h("p", { class: "err" }, "That password didn't work. Try again.") : null,
      input
    ].filter(Boolean) as Node[],
    [{ label: "Cancel", value: "cancel" }, { label: "Unlock", value: "ok", primary: true }]
  );
  setTimeout(() => input.focus(), 50);
  const v = await res;
  if (v !== "ok") return null;
  busy("Unlocking…");
  return input.value;
}

// ---------- File input ----------

export interface PickerOptions {
  accept: string;
  multiple?: boolean;
  label: string;
  hint?: string;
  /** Keep picked files in the library so they show up under Recent. Off for sensitive tools. */
  remember?: boolean;
  onFiles: (files: File[]) => void;
}

// Files handed to the next tool that opens (from the ＋ sheet, Home or Files).
let pending: File[] | null = null;
export function handOff(files: File[]) {
  pending = files;
}

/** Coloured file-type badge; the text carries the meaning, colour only helps scanning. */
export function badge(name: string, type = ""): HTMLElement {
  const kind = kindOf({ name, type });
  const ext = kind === "image" ? "IMG" : (extOf(name) || "FILE").slice(0, 4).toUpperCase();
  return h("span", { class: `badge k-${kind}`, "aria-hidden": "true" }, ext);
}

export function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 2) return "Yesterday";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * File chooser used by every tool: recent files from the library first, then
 * the system picker (Photos, Files, iCloud Drive on iPhone; Explorer on Windows).
 */
export function dropZone(o: PickerOptions): HTMLElement {
  const remember = o.remember !== false;
  const deliver = (files: File[], fromDevice: boolean) => {
    if (fromDevice && remember) files.forEach((f) => lib.addFile(f).catch(() => {}));
    o.onFiles(files);
  };
  const input = h("input", { type: "file", accept: o.accept, multiple: !!o.multiple, hidden: true, onchange: () => {
    if (input.files?.length) deliver(Array.from(input.files), true);
    input.value = "";
  } });
  const zone = h("div", { class: "drop", tabindex: 0, role: "button", onclick: () => input.click(),
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } },
    icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', 26),
    h("strong", {}, o.label),
    h("span", { class: "muted small" }, o.hint ?? (matchMedia("(pointer: coarse)").matches ? "Browse Photos, Files or iCloud Drive" : "Browse, or drop files here")),
    input
  );
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) deliver(o.multiple ? files : files.slice(0, 1), true);
  });

  const recent = h("div", { class: "recent-pick", hidden: true });
  const wrap = h("div", { class: "picker" }, recent, zone);

  if (remember) {
    lib.recentFiles(40).then((items) => {
      const matches = items.filter((f) => lib.accepts(o.accept, f)).slice(0, 8);
      if (!matches.length) return;
      const chosen = new Set<string>();
      const use = h("button", { class: "btn small primary", hidden: true, onclick: async () => {
        const files = (await Promise.all([...chosen].map((id) => lib.getFile(id)))).filter((f): f is File => !!f);
        [...chosen].forEach((id) => lib.touch(id));
        deliver(files, false);
      } });
      const chips = matches.map((m) =>
        h("button", { class: "chip", "aria-pressed": "false", title: m.name, onclick: async (e: Event) => {
          const btn = e.currentTarget as HTMLElement;
          if (!o.multiple) {
            const f = await lib.getFile(m.id);
            if (f) { lib.touch(m.id); deliver([f], false); }
            return;
          }
          chosen.has(m.id) ? chosen.delete(m.id) : chosen.add(m.id);
          btn.setAttribute("aria-pressed", String(chosen.has(m.id)));
          use.hidden = !chosen.size;
          use.textContent = `Use ${chosen.size} file${chosen.size === 1 ? "" : "s"}`;
        } }, badge(m.name, m.type), h("span", { class: "chip-name" }, m.name))
      );
      recent.replaceChildren(
        h("div", { class: "row between" }, h("span", { class: "flabel" }, "Recent"), use),
        h("div", { class: "chips" }, ...chips)
      );
      recent.hidden = false;
    }).catch(() => {});
  }

  // Files handed over from Home, Files or the ＋ sheet open straight away.
  if (pending) {
    const files = pending.filter((f) => lib.accepts(o.accept, f));
    pending = null;
    if (files.length) setTimeout(() => o.onFiles(o.multiple ? files : files.slice(0, 1)), 0);
  }
  return wrap;
}

// ---------- Results ----------

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function share(files: File[]) {
  try {
    await navigator.share({ files });
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast("Sharing isn't available here. Use Download instead.", "error");
  }
}

function canShare(files: File[]) {
  try {
    return !!navigator.canShare?.({ files });
  } catch {
    return false;
  }
}

/** Shows finished files with Download and Share (Share → "Save to Files" on iPhone). */
export function results(host: HTMLElement, files: File[], note?: string, opts: { save?: boolean } = {}) {
  host.replaceChildren();
  if (!files.length) return;
  const saving = opts.save !== false && getSettings().saveToLibrary;
  if (saving) files.forEach((f) => lib.addFile(f).catch(() => toast("Couldn't save to Files: storage may be full.", "error")));
  const list = h("ul", { class: "results" },
    ...files.map((f) =>
      h("li", {},
        badge(f.name, f.type),
        h("span", { class: "fname" }, f.name),
        h("span", { class: "muted small nowrap" }, formatSize(f.size)),
        h("div", { class: "row" },
          canShare([f]) ? h("button", { class: "btn small", onclick: () => share([f]) }, "Share") : null,
          h("button", { class: "btn small primary", onclick: () => download(f) }, "Download")
        )
      )
    )
  );
  const all = files.length > 1
    ? h("div", { class: "row wrap" },
        canShare(files) ? h("button", { class: "btn", onclick: () => share(files) }, "Share all") : null,
        h("button", { class: "btn primary", onclick: async () => download(await zipFiles(files)) }, "Download all (.zip)")
      )
    : null;
  host.append(
    h("section", { class: "card done-card" },
      h("h3", {}, files.length > 1 ? `${files.length} files ready` : "Your file is ready"),
      note ? h("p", { class: "muted" }, note) : null,
      list,
      all,
      saving ? h("p", { class: "muted small" }, "Saved in ", h("a", { href: "#/files" }, "Files"), ". Use Share → Save to Files to keep a copy in your iPhone's Files app.") : null
    )
  );
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export { download, share, canShare };

export function segmented<T extends string>(name: string, options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  return h("div", { class: "seg", role: "radiogroup" },
    ...options.map(([v, label]) =>
      h("label", {},
        h("input", { type: "radio", name, value: v, checked: v === value, onchange: () => onChange(v) }),
        h("span", {}, label)
      )
    )
  );
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "flabel" }, label), control, hint ? h("span", { class: "muted small" }, hint) : null);
}

/** replaceChildren that skips null/false, for conditional content. */
export function fill(el: Element, ...kids: Child[]) {
  el.replaceChildren(...(kids.filter((k) => k !== null && k !== undefined && k !== false) as (Node | string)[]));
}

// ---------- Sheets ----------

export interface Sheet {
  el: HTMLDialogElement;
  close: () => void;
}

/**
 * A bottom sheet on phones and a centred panel on wide screens. Dismiss with
 * Cancel, a tap outside, Escape, or by dragging the grabber down.
 */
export function sheet(title: string, body: (Node | null)[], onClose?: () => void): Sheet {
  const dlg = h("dialog", { class: "sheet", "aria-label": title }) as HTMLDialogElement;
  const close = () => dlg.open && dlg.close();
  const grabber = h("div", { class: "grabber", "aria-hidden": "true" });
  const head = h("header", { class: "sheet-head" },
    h("button", { class: "link-btn", onclick: close }, "Cancel"),
    h("h3", {}, title),
    h("span")
  );
  dlg.append(grabber, head, h("div", { class: "sheet-body" }, ...(body.filter(Boolean) as Node[])));
  document.body.append(dlg);
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });

  // Drag down on the grabber or title bar to dismiss.
  let startY = -1;
  const down = (e: PointerEvent) => { startY = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => { if (startY >= 0) dlg.style.translate = `0 ${Math.max(0, e.clientY - startY)}px`; };
  const up = (e: PointerEvent) => {
    if (startY < 0) return;
    const dy = e.clientY - startY;
    startY = -1;
    if (dy > 90) close();
    else dlg.style.translate = "";
  };
  for (const el of [grabber, head.querySelector("h3")!]) {
    el.addEventListener("pointerdown", down as EventListener);
    el.addEventListener("pointermove", move as EventListener);
    el.addEventListener("pointerup", up as EventListener);
    el.addEventListener("pointercancel", up as EventListener);
  }
  dlg.showModal();
  return { el: dlg, close };
}

/** A tappable row for sheets and settings: icon, title, optional detail. */
export function row(opts: { icon?: string; tint?: string; title: string; detail?: string; danger?: boolean; onclick: () => void }): HTMLElement {
  const glyph = opts.icon ? h("span", { class: `row-icon${opts.tint ? " tile-icon" : ""}`, "aria-hidden": "true" }, icon(opts.icon, 22)) : null;
  if (glyph && opts.tint) glyph.style.setProperty("--tint", opts.tint);
  return h("button", { class: `list-row${opts.danger ? " danger" : ""}`, onclick: opts.onclick },
    glyph,
    h("span", { class: "row-text" }, h("span", {}, opts.title), opts.detail ? h("span", { class: "muted small" }, opts.detail) : null),
    icon('<path d="m9 18 6-6-6-6"/>', 16)
  );
}

export async function confirmDanger(title: string, message: string, action: string): Promise<boolean> {
  const r = await dialog(title, [h("p", { class: "muted" }, message)], [
    { label: "Cancel", value: "cancel" },
    { label: action, value: "ok", primary: true }
  ]);
  return r === "ok";
}

export async function promptText(title: string, value: string, action: string): Promise<string | null> {
  const input = h("input", { class: "input", value });
  const res = dialog(title, [input], [{ label: "Cancel", value: "cancel" }, { label: action, value: "ok", primary: true }]);
  setTimeout(() => { input.focus(); input.select(); }, 50);
  const r = await res;
  const v = input.value.trim();
  return r === "ok" && v ? v : null;
}

export function formatList(files: File[]): HTMLElement {
  return h("ul", { class: "filelist" },
    ...files.map((f) => h("li", {}, badge(f.name, f.type), h("span", { class: "fname" }, f.name), h("span", { class: "muted small nowrap" }, formatSize(f.size)))));
}
