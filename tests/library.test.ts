// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import * as lib from "../src/lib/library";

const file = (name: string, text = name, type = "application/pdf") => new File([text], name, { type });

describe("library", () => {
  it("stores files and folders, and lists recents newest first", async () => {
    await lib.clearLibrary();
    const a = await lib.addFile(file("a.pdf"));
    await new Promise((r) => setTimeout(r, 5));
    const folder = await lib.createFolder("Invoices");
    const b = await lib.addFile(file("b.docx", "bb", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), folder.id);
    expect((await lib.recentFiles()).map((f) => f.name)).toEqual(["b.docx", "a.pdf"]);
    const back = await lib.getFile(b.id);
    expect(await back!.text()).toBe("bb");

    // Re-adding the same file bumps it instead of duplicating.
    await new Promise((r) => setTimeout(r, 5));
    await lib.addFile(file("a.pdf"));
    expect((await lib.listFiles()).length).toBe(2);
    expect((await lib.recentFiles())[0].id).toBe(a.id);

    await lib.renameFile(a.id, "renamed.pdf");
    await lib.moveFile(a.id, folder.id);
    const moved = (await lib.listFiles()).find((f) => f.id === a.id)!;
    expect(moved).toMatchObject({ name: "renamed.pdf", folderId: folder.id });

    await lib.deleteFolder(folder.id);
    expect(await lib.listFiles()).toEqual([]);
    expect(await lib.listFolders()).toEqual([]);
  });

  it("matches accept strings", () => {
    expect(lib.accepts(".pdf,application/pdf", { name: "x.PDF", type: "" })).toBe(true);
    expect(lib.accepts("image/*", { name: "x.heic", type: "image/heic" })).toBe(true);
    expect(lib.accepts(".pdf", { name: "x.docx", type: "" })).toBe(false);
    expect(lib.accepts("*/*", { name: "x", type: "" })).toBe(true);
  });
});
