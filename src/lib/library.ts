// The app's own document library: files and folders kept in IndexedDB on
// this device. Everything people add or create lands here, so Home can show
// recent files and every tool can offer them without another trip to the
// system file picker.

export interface LibFile {
  id: string;
  name: string;
  type: string;
  size: number;
  folderId: string | null;
  created: number;
  used: number; // last opened, added or produced
}

export interface LibFolder {
  id: string;
  name: string;
  parentId: string | null;
  created: number;
}

const DB = "scanonce";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("files", { keyPath: "id" });
        d.createObjectStore("blobs");
        d.createObjectStore("folders", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Ask the browser not to evict the library under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
  }
  return dbp;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Storage is full or unavailable"));
  });
}

function all<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror = () => reject(r.error);
  });
}

const listeners = new Set<() => void>();
/** Runs `fn` whenever the library changes. Returns an unsubscribe function. */
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function addFile(file: File, folderId: string | null = null): Promise<LibFile> {
  const d = await db();
  // The same file picked twice (same name and size) updates its "used" time instead of duplicating.
  const existing = (await listFiles()).find((f) => f.name === file.name && f.size === file.size && f.folderId === folderId);
  const now = Date.now();
  if (existing) {
    await touch(existing.id);
    return { ...existing, used: now };
  }
  const meta: LibFile = { id: uid(), name: file.name, type: file.type, size: file.size, folderId, created: now, used: now };
  // Stored as raw bytes: more reliable across browsers (older Safari) than Blobs.
  const bytes = await file.arrayBuffer();
  const tx = d.transaction(["files", "blobs"], "readwrite");
  tx.objectStore("files").put(meta);
  tx.objectStore("blobs").put(bytes, meta.id);
  await done(tx);
  changed();
  return meta;
}

export async function listFiles(): Promise<LibFile[]> {
  const d = await db();
  return all<LibFile>(d.transaction("files").objectStore("files"));
}

export async function listFolders(): Promise<LibFolder[]> {
  const d = await db();
  return (await all<LibFolder>(d.transaction("folders").objectStore("folders"))).sort((a, b) => a.name.localeCompare(b.name));
}

export async function recentFiles(limit = 8): Promise<LibFile[]> {
  return (await listFiles()).sort((a, b) => b.used - a.used).slice(0, limit);
}

export async function getFile(id: string): Promise<File | null> {
  const d = await db();
  const tx = d.transaction(["files", "blobs"]);
  const [meta, blob] = await Promise.all([
    new Promise<LibFile | undefined>((r) => { const q = tx.objectStore("files").get(id); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }),
    new Promise<ArrayBuffer | undefined>((r) => { const q = tx.objectStore("blobs").get(id); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); })
  ]);
  if (!meta || !blob) return null;
  return new File([blob], meta.name, { type: meta.type });
}

async function update(id: string, patch: Partial<LibFile>) {
  const d = await db();
  const tx = d.transaction("files", "readwrite");
  const store = tx.objectStore("files");
  const q = store.get(id);
  q.onsuccess = () => { if (q.result) store.put({ ...q.result, ...patch }); };
  await done(tx);
  changed();
}

export const touch = (id: string) => update(id, { used: Date.now() });
export const renameFile = (id: string, name: string) => update(id, { name });
export const moveFile = (id: string, folderId: string | null) => update(id, { folderId });

export async function deleteFile(id: string) {
  const d = await db();
  const tx = d.transaction(["files", "blobs"], "readwrite");
  tx.objectStore("files").delete(id);
  tx.objectStore("blobs").delete(id);
  await done(tx);
  changed();
}

export async function createFolder(name: string, parentId: string | null = null): Promise<LibFolder> {
  const d = await db();
  const folder: LibFolder = { id: uid(), name, parentId, created: Date.now() };
  const tx = d.transaction("folders", "readwrite");
  tx.objectStore("folders").put(folder);
  await done(tx);
  changed();
  return folder;
}

export async function renameFolder(id: string, name: string) {
  const d = await db();
  const tx = d.transaction("folders", "readwrite");
  const store = tx.objectStore("folders");
  const q = store.get(id);
  q.onsuccess = () => { if (q.result) store.put({ ...q.result, name }); };
  await done(tx);
  changed();
}

/** Deletes a folder with everything inside it, including subfolders. */
export async function deleteFolder(id: string) {
  const folders = await listFolders();
  const files = await listFiles();
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) { doomed.add(f.id); grew = true; }
  }
  const d = await db();
  const tx = d.transaction(["files", "blobs", "folders"], "readwrite");
  for (const f of files) if (f.folderId && doomed.has(f.folderId)) { tx.objectStore("files").delete(f.id); tx.objectStore("blobs").delete(f.id); }
  for (const fid of doomed) tx.objectStore("folders").delete(fid);
  await done(tx);
  changed();
}

export async function clearLibrary() {
  const d = await db();
  const tx = d.transaction(["files", "blobs", "folders"], "readwrite");
  for (const s of ["files", "blobs", "folders"]) tx.objectStore(s).clear();
  await done(tx);
  changed();
}

export async function usedBytes(): Promise<number> {
  return (await listFiles()).reduce((n, f) => n + f.size, 0);
}

/** Does a file match an <input accept> string such as ".pdf,image/*"? */
export function accepts(accept: string, f: { name: string; type: string }): boolean {
  if (!accept || accept === "*/*") return true;
  const name = f.name.toLowerCase();
  return accept.split(",").map((s) => s.trim().toLowerCase()).some((a) =>
    a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? f.type.startsWith(a.slice(0, -1)) : f.type === a
  );
}
