import { formatSize, zipFiles } from "./lib/files";
import { UserCancelled } from "./lib/pdfops";

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
  camera?: boolean;
  onFiles: (files: File[]) => void;
}

export function dropZone(o: PickerOptions): HTMLElement {
  const input = h("input", { type: "file", accept: o.accept, multiple: !!o.multiple, hidden: true, onchange: () => {
    if (input.files?.length) o.onFiles(Array.from(input.files));
    input.value = "";
  } });
  const zone = h("div", { class: "drop", tabindex: 0, role: "button", onclick: () => input.click(),
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } },
    icon('<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', 28),
    h("strong", {}, o.label),
    h("span", { class: "muted" }, o.hint ?? "or drop files here"),
    input
  );
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) o.onFiles(o.multiple ? files : files.slice(0, 1));
  });
  return zone;
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
export function results(host: HTMLElement, files: File[], note?: string) {
  host.replaceChildren();
  if (!files.length) return;
  const list = h("ul", { class: "results" },
    ...files.map((f) =>
      h("li", {},
        h("span", { class: "fname" }, f.name),
        h("span", { class: "muted" }, formatSize(f.size)),
        h("div", { class: "row" },
          canShare([f]) ? h("button", { class: "btn small", onclick: () => share([f]) }, "Share") : null,
          h("button", { class: "btn small primary", onclick: () => download(f) }, "Download")
        )
      )
    )
  );
  const all = files.length > 1
    ? h("div", { class: "row" },
        canShare(files) ? h("button", { class: "btn", onclick: () => share(files) }, "Share all") : null,
        h("button", { class: "btn primary", onclick: async () => download(await zipFiles(files)) }, "Download all (.zip)")
      )
    : null;
  host.append(
    h("section", { class: "card done-card" },
      h("h3", {}, files.length > 1 ? `${files.length} files ready` : "Your file is ready"),
      note ? h("p", { class: "muted" }, note) : null,
      list,
      all
    )
  );
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

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
