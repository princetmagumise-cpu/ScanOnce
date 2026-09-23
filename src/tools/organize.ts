import type { Tool } from "./types";
import { h, icon, dropZone, results, run, busy, askPassword } from "../ui";
import { makeFile, baseName } from "../lib/files";
import { openPdf, buildFromPlan, type PagePlan, type OpenedPdf } from "../lib/pdfops";
import { loadPdfJs, renderPage } from "../lib/pdfjs";

interface Card extends PagePlan { thumb?: HTMLCanvasElement; key: number }

export const organizeTool: Tool = {
  id: "organize",
  title: "Organize pages",
  blurb: "Reorder, rotate, delete, duplicate and insert pages.",
  group: "Organize",
  icon: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  tint: "#30B0C7",
  render(root) {
    const sources: OpenedPdf[] = [];
    let cards: Card[] = [];
    let keySeq = 0;
    const out = h("div");
    const grid = h("div", { class: "pages" });
    const bar = h("section", { class: "card sticky", hidden: true },
      h("div", { class: "row wrap" },
        h("button", { class: "btn primary", onclick: () => save() }, "Save PDF"),
        h("button", { class: "btn", onclick: () => addInput.click() }, "Add pages from another PDF"),
        h("button", { class: "btn", onclick: () => { cards.push({ src: -1, page: 0, rotate: 0, key: keySeq++ }); draw(); } }, "Add blank page")
      )
    );
    const addInput = h("input", { type: "file", accept: ".pdf,application/pdf", hidden: true, onchange: () => {
      const f = addInput.files?.[0];
      addInput.value = "";
      if (f) load(f);
    } });

    const load = (f: File) =>
      run("Opening…", async () => {
        const opened = await openPdf(f, askPassword);
        const src = sources.push(opened) - 1;
        const proxy = await loadPdfJs(opened.bytes);
        const count = proxy.numPages;
        const fresh: Card[] = [];
        for (let i = 0; i < count; i++) fresh.push({ src, page: i, rotate: 0, key: keySeq++ });
        cards.push(...fresh);
        draw();
        // Render thumbnails progressively so large files stay responsive.
        for (let i = 0; i < count; i++) {
          busy(`Loading page ${i + 1} of ${count}…`, i / count);
          const page = await proxy.getPage(i + 1);
          const vp = page.getViewport({ scale: 1 });
          fresh[i].thumb = await renderPage(page, 170 / Math.max(vp.width, vp.height));
          page.cleanup();
          if (i % 6 === 5 || i === count - 1) draw();
        }
        proxy.loadingTask.destroy();
        out.replaceChildren();
      });

    let dragFrom = -1;
    const draw = () => {
      bar.hidden = !cards.length;
      grid.replaceChildren(
        ...cards.map((c, i) => {
          const face = c.src < 0
            ? h("div", { class: "blank" }, "Blank")
            : c.thumb
              ? (() => { const img = c.thumb!.cloneNode() as HTMLCanvasElement; img.getContext("2d")!.drawImage(c.thumb!, 0, 0); return img; })()
              : h("div", { class: "blank" }, "…");
          (face as HTMLElement).style.transform = `rotate(${c.rotate}deg)`;
          return h("figure", { class: "page", draggable: true,
              ondragstart: () => (dragFrom = i),
              ondragover: (e: DragEvent) => e.preventDefault(),
              ondrop: (e: DragEvent) => {
                e.preventDefault();
                if (dragFrom < 0 || dragFrom === i) return;
                const [m] = cards.splice(dragFrom, 1);
                cards.splice(i, 0, m);
                dragFrom = -1;
                draw();
              } },
            h("div", { class: "thumb" }, face),
            h("figcaption", {},
              h("span", {}, String(i + 1)),
              h("div", { class: "row tight" },
                h("button", { class: "icon-btn", title: "Move earlier", disabled: i === 0, onclick: () => { [cards[i - 1], cards[i]] = [cards[i], cards[i - 1]]; draw(); } }, icon('<path d="m15 18-6-6 6-6"/>', 18)),
                h("button", { class: "icon-btn", title: "Move later", disabled: i === cards.length - 1, onclick: () => { [cards[i + 1], cards[i]] = [cards[i], cards[i + 1]]; draw(); } }, icon('<path d="m9 18 6-6-6-6"/>', 18)),
                h("button", { class: "icon-btn", title: "Rotate", onclick: () => { c.rotate = (c.rotate + 90) % 360; draw(); } }, icon('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 18)),
                h("button", { class: "icon-btn", title: "Duplicate", onclick: () => { cards.splice(i + 1, 0, { ...c, key: keySeq++ }); draw(); } }, icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', 18)),
                h("button", { class: "icon-btn danger", title: "Delete", onclick: () => { cards.splice(i, 1); draw(); } }, icon('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>', 18))
              )
            )
          );
        })
      );
    };

    const save = () =>
      run("Saving…", async () => {
        if (!cards.length) throw new Error("There are no pages left to save.");
        const bytes = await buildFromPlan(sources.map((s) => s.doc), cards);
        results(out, [makeFile(bytes, `${baseName(sources[0].name)} (organized).pdf`)]);
      });

    root.append(
      h("section", { class: "card" }, dropZone({ accept: ".pdf,application/pdf", label: "Choose a PDF to organize", onFiles: ([f]) => { sources.length = 0; cards = []; load(f); } }), addInput),
      bar,
      grid,
      out
    );
  }
};
