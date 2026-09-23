import mammoth from "mammoth/mammoth.browser.js";
import type { Block, DocModel } from "../docmodel";
import { base64ToBytes, clean, toImageBlock } from "./common";

export async function readDocx(bytes: Uint8Array, title: string): Promise<DocModel> {
  const images: Record<string, { bytes: Uint8Array; type: string }> = {};
  let n = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: bytes.slice().buffer },
    {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const id = `img${n++}`;
        images[id] = { bytes: base64ToBytes(await image.read("base64")), type: image.contentType };
        return { src: id };
      })
    }
  );
  const dom = new DOMParser().parseFromString(`<body>${result.value}</body>`, "text/html");
  const blocks: Block[] = [];

  const walk = async (el: Element) => {
    for (const node of Array.from(el.children)) {
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = clean(node.textContent);
        if (text) blocks.push({ type: "heading", level: Math.min(3, Number(tag[1])) as 1 | 2 | 3, text });
      } else if (tag === "p") {
        for (const img of Array.from(node.querySelectorAll("img"))) await pushImage(img);
        const text = clean(node.textContent);
        if (text) {
          const strong = node.querySelector("strong");
          const bold = !!strong && clean(strong.textContent) === text;
          blocks.push({ type: "paragraph", text, bold: bold || undefined });
        }
      } else if (tag === "ul" || tag === "ol") {
        const items = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === "li").map((li) => clean(li.textContent));
        if (items.length) blocks.push({ type: "list", items, ordered: tag === "ol" });
      } else if (tag === "table") {
        const rows = Array.from(node.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.children).map((td) => clean(td.textContent))
        );
        if (rows.length) blocks.push({ type: "table", rows });
      } else if (tag === "img") {
        await pushImage(node);
      } else {
        await walk(node);
      }
    }
  };
  const pushImage = async (img: Element) => {
    const found = images[img.getAttribute("src") ?? ""];
    if (!found) return;
    const block = await toImageBlock(found.bytes, found.type);
    if (block) blocks.push(block);
  };
  await walk(dom.body);
  return { title, sections: [{ blocks }] };
}
