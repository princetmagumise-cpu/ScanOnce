import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import type { Block, DocModel, Section } from "../docmodel";
import { clean, toImageBlock } from "./common";

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// xmldom behaves the same in every browser and in tests; match elements on
// their local names so namespace prefixes don't matter.
type El = Element;
function all(root: El | Document, local: string): El[] {
  return Array.from(root.getElementsByTagName("*") as unknown as ArrayLike<El>).filter((e) => e.localName === local);
}

function children(el: El): El[] {
  return Array.from(el.childNodes as unknown as ArrayLike<Node>).filter((n): n is El => n.nodeType === 1);
}

function relId(el: Element | undefined, local: string): string {
  if (!el) return "";
  for (const a of Array.from(el.attributes as unknown as ArrayLike<Attr>)) {
    if (a.name === `r:${local}` || (a.localName === local && a.namespaceURI === NS_R)) return a.value;
  }
  return "";
}

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml") as unknown as Document;
}

function resolve(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/");
  parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

async function rels(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.substring(0, partPath.lastIndexOf("/"));
  const file = `${dir}/_rels/${partPath.substring(partPath.lastIndexOf("/") + 1)}.rels`;
  const map = new Map<string, string>();
  const xml = await zip.file(file)?.async("string");
  if (!xml) return map;
  for (const r of all(parse(xml), "Relationship")) {
    map.set(r.getAttribute("Id")!, resolve(partPath, r.getAttribute("Target")!));
  }
  return map;
}

function paragraphs(txBody: Element): string[] {
  return Array.from(all(txBody, "p"))
    .map((p) => clean(Array.from(all(p, "t")).map((t) => t.textContent).join("")))
    .filter(Boolean);
}

/** Text boxes that aren't title placeholders but are clearly used as one: short, big, near the top. */
function looksLikeTitle(sp: Element, paras: string[]): boolean {
  if (paras.length !== 1 || paras[0].length > 120) return false;
  const off = all(sp, "off")[0];
  const y = Number(off?.getAttribute("y") ?? Infinity);
  const sizes = Array.from(all(sp, "rPr")).map((r) => Number(r.getAttribute("sz") ?? 0));
  return y < 1_300_000 && Math.max(0, ...sizes) >= 2400;
}

export async function readPptx(bytes: Uint8Array, title: string): Promise<DocModel> {
  const zip = await JSZip.loadAsync(bytes);
  const presPath = "ppt/presentation.xml";
  const pres = parse(await zip.file(presPath)!.async("string"));
  const presRels = await rels(zip, presPath);
  const slidePaths = Array.from(all(pres, "sldId"))
    .map((s) => presRels.get(relId(s, "id")))
    .filter((p): p is string => !!p && !!zip.file(p));

  const sections: Section[] = [];
  for (const path of slidePaths) {
    const doc = parse(await zip.file(path)!.async("string"));
    const slideRels = await rels(zip, path);
    const blocks: Block[] = [];
    let slideTitle: string | undefined;
    const tree = all(doc, "spTree")[0];
    if (!tree) continue;

    const visit = async (parent: Element) => {
      for (const el of children(parent)) {
        const local = el.localName;
        if (local === "grpSp") {
          await visit(el);
        } else if (local === "sp") {
          const ph = all(el, "ph")[0];
          const phType = ph?.getAttribute("type") ?? "";
          const body = all(el, "txBody")[0];
          if (!body) continue;
          const paras = paragraphs(body);
          if (!paras.length) continue;
          const isTitle = phType === "title" || phType === "ctrTitle" || (!ph && looksLikeTitle(el, paras));
          if (isTitle && !slideTitle) {
            slideTitle = paras.join(" ");
          } else if (phType === "subTitle" || paras.length === 1) {
            blocks.push({ type: "paragraph", text: paras.join(" ") });
          } else {
            blocks.push({ type: "list", items: paras });
          }
        } else if (local === "graphicFrame") {
          const tbl = all(el, "tbl")[0];
          if (!tbl) continue;
          const rows = Array.from(all(tbl, "tr")).map((tr) =>
            Array.from(all(tr, "tc")).map((tc) => paragraphs(tc).join("\n"))
          );
          if (rows.length) blocks.push({ type: "table", rows });
        } else if (local === "pic") {
          const blip = all(el, "blip")[0];
          const rid = relId(blip, "embed");
          const target = rid ? slideRels.get(rid) : undefined;
          const file = target ? zip.file(target) : null;
          if (!file) continue;
          const ext = target!.split(".").pop()!.toLowerCase();
          const img = await toImageBlock(await file.async("uint8array"), `image/${ext === "jpg" ? "jpeg" : ext}`);
          if (img) blocks.push(img);
        }
      }
    };
    await visit(tree);
    if (slideTitle) blocks.unshift({ type: "heading", level: 1, text: slideTitle });
    sections.push({ title: slideTitle, blocks, landscape: true });
  }
  return { title, sections };
}
