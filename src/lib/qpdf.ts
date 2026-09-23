import createModule from "@neslinesli93/qpdf-wasm";
import wasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { isNode } from "./files";

// qpdf (compiled to WebAssembly) does the jobs pdf-lib can't: real PDF
// encryption and decryption, and lossless structural compression.

export class QpdfError extends Error {}

function wasmLocation(): string {
  if (isNode) return process.cwd() + wasmUrl; // tests under Node
  return wasmUrl;
}

/**
 * Runs qpdf with `args`, where "IN" and "OUT" stand for the input and output
 * files. Exit code 3 means "succeeded with warnings", which is fine for us.
 */
export async function runQpdf(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const errors: string[] = [];
  // This qpdf build ignores print/printErr options and binds console.log and
  // console.error when the module is created, so swap them in just for that
  // synchronous moment to capture its messages.
  const { log, error } = console;
  console.log = () => {};
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  let pending: Promise<any>;
  try {
    pending = (createModule as any)({ locateFile: wasmLocation, noInitialRun: true });
  } finally {
    console.log = log;
    console.error = error;
  }
  const q = await pending;
  q.FS.writeFile("/in.pdf", input);
  const argv = args.map((a) => (a === "IN" ? "/in.pdf" : a === "OUT" ? "/out.pdf" : a));
  let rc: number;
  try {
    rc = q.callMain(argv);
  } catch (e) {
    throw new QpdfError(errors.join("\n") || String(e));
  }
  if (rc !== 0 && rc !== 3) {
    const msg = errors.join("\n").replace(/^.*?\/in\.pdf:?\s*/gm, "");
    throw new QpdfError(msg || `qpdf failed (${rc})`);
  }
  return q.FS.readFile("/out.pdf") as Uint8Array;
}

export interface Permissions {
  print: boolean;
  copy: boolean;
  modify: boolean;
}

export function encryptPdf(input: Uint8Array, userPassword: string, ownerPassword: string, perms: Permissions) {
  const owner = ownerPassword || userPassword + "\u0001owner" + Math.random().toString(36).slice(2);
  return runQpdf(input, [
    "--encrypt", userPassword, owner, "256",
    `--print=${perms.print ? "full" : "none"}`,
    `--extract=${perms.copy ? "y" : "n"}`,
    `--modify=${perms.modify ? "all" : "none"}`,
    "--", "IN", "OUT"
  ]);
}

export async function decryptPdf(input: Uint8Array, password: string): Promise<Uint8Array> {
  try {
    return await runQpdf(input, [`--password=${password}`, "--decrypt", "IN", "OUT"]);
  } catch (e) {
    if (/invalid password/i.test((e as Error).message)) throw new QpdfError("That password is not correct.");
    throw e;
  }
}

export function optimizePdf(input: Uint8Array): Promise<Uint8Array> {
  return runQpdf(input, [
    "--object-streams=generate",
    "--compress-streams=y",
    "--recompress-flate",
    "--compression-level=9",
    "--remove-unreferenced-resources=yes",
    "IN", "OUT"
  ]);
}
