// Small per-device preferences. Stored in localStorage; every read falls back
// to a default so the app works even where storage is blocked.

export interface Settings {
  saveToLibrary: boolean;
  pageSize: "a4" | "letter" | "fit";
  scanFilter: "enhance" | "original" | "gray" | "bw";
  ocrLang: string;
  autoCapture: boolean;
}

const DEFAULTS: Settings = { saveToLibrary: true, pageSize: "a4", scanFilter: "enhance", ocrLang: "eng", autoCapture: true };
const KEY = "scanonce.settings";

export function getSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getSettings(), [key]: value }));
  } catch {
    /* not persisted; the default applies next time */
  }
}

const TOOLS_KEY = "scanonce.recentTools";

export function recentTools(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TOOLS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function noteToolUsed(id: string) {
  try {
    localStorage.setItem(TOOLS_KEY, JSON.stringify([id, ...recentTools().filter((t) => t !== id)].slice(0, 6)));
  } catch {
    /* ignore */
  }
}
