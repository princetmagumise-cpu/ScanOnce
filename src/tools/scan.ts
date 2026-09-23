import type { Tool } from "./types";
import { h, icon, dropZone, results, run, segmented, field, toast, dialog, busy } from "../ui";
import { fileToCanvas, canvasToBytes, rotateCanvas, makeCanvas, nextFrame } from "../lib/image";
import { detectPage, fullQuad, warp, applyFilter, type Quad, type Filter } from "../lib/scan";
import { imagesToPdf, savePdf, type PageSize, type PdfImage } from "../lib/pdfops";
import { makeFile } from "../lib/files";
import { LANGUAGES } from "../lib/languages";
import { getSettings } from "../lib/settings";

interface ScanPage {
  original: HTMLCanvasElement;
  quad: Quad;
  turns: number;
  filter: Filter;
  processed?: HTMLCanvasElement;
}

const FILTERS: [Filter, string][] = [["enhance", "Auto"], ["original", "Original"], ["gray", "Grayscale"], ["bw", "Black & white"]];

function process(p: ScanPage): HTMLCanvasElement {
  if (!p.processed) p.processed = applyFilter(rotateCanvas(warp(p.original, p.quad), p.turns), p.filter);
  return p.processed;
}

function thumb(c: HTMLCanvasElement, max = 360): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(c.width, c.height));
  const t = makeCanvas(Math.round(c.width * s), Math.round(c.height * s));
  t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
  return t;
}

export const scanTool: Tool = {
  id: "scan",
  title: "Scan to PDF",
  blurb: "Photograph pages, straighten and clean them up, save as one PDF.",
  group: "Scan & create",
  icon: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M4 12h16"/>',
  render(root) {
    const pages: ScanPage[] = [];
    const prefs = getSettings();
    let size: PageSize = prefs.pageSize;
    let defaultFilter: Filter = prefs.scanFilter;
    let ocr = false;
    let lang = prefs.ocrLang;
    const grid = h("div", { class: "pages" });
    const out = h("div");
    const nameInput = h("input", { class: "input", value: `Scan ${new Date().toISOString().slice(0, 10)}` });

    const addFiles = (files: File[]) =>
      run("Preparing pages…", async () => {
        for (const [i, f] of files.entries()) {
          busy(`Preparing page ${i + 1} of ${files.length}…`, i / files.length);
          await addCanvas(await fileToCanvas(f, 3000));
        }
        redraw();
      });

    const addCanvas = async (original: HTMLCanvasElement) => {
      await nextFrame();
      const quad = detectPage(original) ?? fullQuad(original.width, original.height);
      pages.push({ original, quad, turns: 0, filter: defaultFilter });
    };

    const redraw = () => {
      grid.replaceChildren(
        ...pages.map((p, i) =>
          h("figure", { class: "page" },
            h("button", { class: "thumb", title: "Edit page", onclick: () => edit(i) }, thumb(process(p))),
            h("figcaption", {},
              h("span", {}, String(i + 1)),
              h("div", { class: "row tight" },
                h("button", { class: "icon-btn", title: "Move left", disabled: i === 0, onclick: () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; redraw(); } }, icon('<path d="m15 18-6-6 6-6"/>', 18)),
                h("button", { class: "icon-btn", title: "Move right", disabled: i === pages.length - 1, onclick: () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; redraw(); } }, icon('<path d="m9 18 6-6-6-6"/>', 18)),
                h("button", { class: "icon-btn", title: "Edit", onclick: () => edit(i) }, icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>', 18)),
                h("button", { class: "icon-btn danger", title: "Delete page", onclick: () => { pages.splice(i, 1); redraw(); } }, icon('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>', 18))
              )
            )
          )
        )
      );
      actions.hidden = !pages.length;
    };

    const edit = async (i: number) => {
      const p = pages[i];
      const draft = { quad: p.quad.map((q) => ({ ...q })) as Quad, turns: p.turns, filter: p.filter };
      const editor = cropEditor(p.original, draft.quad);
      const preview = h("div", { class: "muted small" }, "Drag the corners to the edges of the page.");
      const body = [
        editor.el,
        preview,
        h("div", { class: "row wrap" },
          h("button", { type: "button", class: "btn small", onclick: () => editor.set(detectPage(p.original) ?? fullQuad(p.original.width, p.original.height)) }, "Auto-detect"),
          h("button", { type: "button", class: "btn small", onclick: () => editor.set(fullQuad(p.original.width, p.original.height)) }, "Whole photo"),
          h("button", { type: "button", class: "btn small", onclick: () => (draft.turns += 3) }, "Rotate left"),
          h("button", { type: "button", class: "btn small", onclick: () => (draft.turns += 1) }, "Rotate right")
        ),
        field("Colour", segmented("filter-edit", FILTERS, draft.filter, (v) => (draft.filter = v)))
      ];
      const res = await dialog(`Page ${i + 1}`, body, [{ label: "Cancel", value: "cancel" }, { label: "Apply", value: "ok", primary: true }]);
      if (res !== "ok") return;
      Object.assign(p, { quad: editor.quad(), turns: draft.turns % 4, filter: draft.filter, processed: undefined });
      await run("Applying…", async () => { process(p); redraw(); });
    };

    const create = () =>
      run("Creating PDF…", async () => {
        const images: PdfImage[] = [];
        for (const [i, p] of pages.entries()) {
          busy(`Processing page ${i + 1} of ${pages.length}…`, i / pages.length);
          await nextFrame();
          const c = process(p);
          const png = p.filter === "bw";
          images.push({ bytes: await canvasToBytes(c, png ? "image/png" : "image/jpeg", 0.82), mime: png ? "image/png" : "image/jpeg", width: c.width, height: c.height });
        }
        const doc = await imagesToPdf(images, size, size === "fit" ? 0 : 18);
        if (ocr) {
          const { recognize, addTextLayer } = await import("../lib/ocr");
          const { embedFonts } = await import("../lib/fonts");
          const font = (await embedFonts(doc)).regular;
          for (const [i, p] of pages.entries()) {
            busy(`Reading text on page ${i + 1} of ${pages.length}…`, i / pages.length);
            const c = process(p);
            const res = await recognize(c, lang, (m, f) => busy(m, f));
            // The image sits centred inside the page margins; map pixels to that box.
            const page = doc.getPage(i);
            const { width: pw, height: ph } = page.getSize();
            const margin = size === "fit" ? 0 : 18;
            const s = Math.min((pw - margin * 2) / c.width, (ph - margin * 2) / c.height);
            const ox = (pw - c.width * s) / 2, oy = (ph - c.height * s) / 2;
            addTextLayer(page, font, res, (x, y) => [ox + x * s, ph - (oy + y * s)]);
          }
        }
        const name = (nameInput.value.trim() || "Scan").replace(/[\\/:*?"<>|]/g, "-");
        results(out, [makeFile(await savePdf(doc), `${name}.pdf`)]);
      });

    const cameraBtn = h("button", { class: "btn", onclick: () => openCamera(async (c) => { await addCanvas(c); redraw(); }) },
      icon('<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>', 18), "Live camera");
    const photoInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onchange: () => {
      if (photoInput.files?.length) addFiles(Array.from(photoInput.files));
      photoInput.value = "";
    } });
    const photoBtn = h("button", { class: "btn primary", onclick: () => photoInput.click() },
      icon('<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>', 18), "Take photo");

    let langField!: HTMLElement;
    const actions = h("section", { class: "card", hidden: true },
      field("File name", nameInput),
      field("Page size", segmented("size", [["a4", "A4"], ["letter", "Letter"], ["fit", "Fit to photo"]], size, (v) => (size = v))),
      field("Colour for new pages", segmented("filter", FILTERS, defaultFilter, (v) => {
        defaultFilter = v;
        pages.forEach((p) => { p.filter = v; p.processed = undefined; });
        run("Updating…", async () => redraw());
      })),
      h("label", { class: "check" },
        h("input", { type: "checkbox", onchange: (e: Event) => { ocr = (e.target as HTMLInputElement).checked; langField.hidden = !ocr; } }),
        h("span", {}, "Make text searchable (OCR)")
      ),
      (() => {
        const sel = h("select", { class: "input", onchange: () => (lang = sel.value) }, ...LANGUAGES.map(([v, l]) => h("option", { value: v, selected: v === lang }, l)));
        return (langField = field("Text language", sel, "Language data downloads once, then works offline."));
      })(),
      h("button", { class: "btn primary big", onclick: create }, "Create PDF")
    );
    langField.hidden = true;

    root.append(
      h("section", { class: "card" },
        h("div", { class: "row wrap" }, photoBtn, cameraBtn, photoInput),
        dropZone({ accept: "image/*", multiple: true, label: "Choose photos or images", hint: "JPG, PNG, HEIC… or drop them here", onFiles: addFiles })
      ),
      grid,
      actions,
      out
    );
    const hasCamera = typeof navigator.mediaDevices?.getUserMedia === "function";
    if (!hasCamera) cameraBtn.hidden = true;
    // Arriving from ＋ → Scan document: go straight to the camera.
    if (location.hash.includes("?camera")) {
      history.replaceState(null, "", "#/tools/scan");
      if (hasCamera) openCamera(async (c) => { await addCanvas(c); redraw(); });
    }
  }
};

/** Corner editor: shows the photo with four draggable handles. */
function cropEditor(src: HTMLCanvasElement, initial: Quad) {
  let quad = initial.map((p) => ({ ...p })) as Quad;
  const maxW = Math.min(window.innerWidth - 64, 640);
  const maxH = Math.min(window.innerHeight * 0.55, 640);
  const s = Math.min(maxW / src.width, maxH / src.height);
  const view = makeCanvas(Math.round(src.width * s), Math.round(src.height * s));
  view.className = "crop-canvas";
  const ctx = view.getContext("2d")!;
  const draw = () => {
    ctx.drawImage(src, 0, 0, view.width, view.height);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.moveTo(quad[0].x * s, quad[0].y * s);
    for (const p of [quad[3], quad[2], quad[1]]) ctx.lineTo(p.x * s, p.y * s);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.strokeStyle = "#2dd4bf";
    ctx.lineWidth = 2;
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)));
    ctx.closePath();
    ctx.stroke();
    for (const p of quad) {
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, 9, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.stroke();
    }
  };
  let drag = -1;
  const pos = (e: PointerEvent) => {
    const r = view.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * (view.width / r.width)) / s, y: ((e.clientY - r.top) * (view.height / r.height)) / s };
  };
  view.addEventListener("pointerdown", (e) => {
    const p = pos(e);
    let best = -1, bd = Infinity;
    quad.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
    if (bd * s < 48) { drag = best; view.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  view.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const p = pos(e);
    quad[drag] = { x: Math.max(0, Math.min(src.width, p.x)), y: Math.max(0, Math.min(src.height, p.y)) };
    draw();
  });
  view.addEventListener("pointerup", () => (drag = -1));
  view.addEventListener("pointercancel", () => (drag = -1));
  draw();
  return {
    el: h("div", { class: "crop" }, view),
    quad: () => quad,
    set: (q: Quad) => { quad = q.map((p) => ({ ...p })) as Quad; draw(); }
  };
}

/** Full-screen live camera (webcams on laptops, or the phone camera). */
async function openCamera(onShot: (c: HTMLCanvasElement) => Promise<void>) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false
    });
  } catch {
    toast("Couldn't open the camera. Check camera permission for this app.", "error");
    return;
  }
  const video = h("video", { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
  video.srcObject = stream;
  let count = 0;
  const counter = h("span", { class: "cam-count" }, "0 pages");
  const close = () => { stream.getTracks().forEach((t) => t.stop()); overlay.remove(); };
  const shoot = async () => {
    if (!video.videoWidth) return;
    const c = makeCanvas(video.videoWidth, video.videoHeight);
    c.getContext("2d")!.drawImage(video, 0, 0);
    overlay.classList.add("flash");
    setTimeout(() => overlay.classList.remove("flash"), 150);
    await onShot(c);
    counter.textContent = `${++count} page${count === 1 ? "" : "s"}`;
  };
  const overlay = h("div", { class: "camera" },
    video,
    h("div", { class: "cam-bar" },
      h("button", { class: "btn", onclick: close }, "Done"),
      h("button", { class: "shutter", "aria-label": "Take picture", onclick: shoot }),
      counter
    )
  );
  document.body.append(overlay);
}
