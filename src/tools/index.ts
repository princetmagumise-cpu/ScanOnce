import type { Tool } from "./types";
import type { Kind } from "../lib/files";
import { scanTool } from "./scan";
import { convertTool } from "./convert";
import { mergeTool } from "./merge";
import { splitTool } from "./split";
import { organizeTool } from "./organize";
import { extractTool } from "./extract";
import { compressTool } from "./compress";
import { ocrTool } from "./ocr";
import { repairTool } from "./repair";
import { protectTool } from "./protect";
import { lockTool } from "./lock";

export const TOOLS: Tool[] = [
  scanTool, convertTool,
  mergeTool, splitTool, organizeTool, extractTool,
  compressTool, ocrTool, repairTool,
  protectTool, lockTool
];

export const GROUPS: Tool["group"][] = ["Scan & create", "Convert", "Organize", "Optimize & fix", "Security"];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);

/** Tools that make sense for a kind of file, most likely first. */
export function toolsFor(kind: Kind): Tool[] {
  const ids: Record<string, string[]> = {
    image: ["scan", "ocr", "convert", "merge", "lock"],
    pdf: ["compress", "convert", "organize", "merge", "split", "ocr", "extract", "protect", "repair", "lock"],
    docx: ["convert", "lock"],
    xlsx: ["convert", "lock"],
    pptx: ["convert", "lock"],
    text: ["convert", "lock"],
    locked: ["lock"],
    unknown: ["lock"]
  };
  return (ids[kind] ?? ids.unknown).map((id) => toolById(id)!).filter(Boolean);
}
