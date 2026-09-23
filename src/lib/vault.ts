// "Lock" any file (Word, Excel, photos, anything) with a password using
// AES-256-GCM. The key comes from the password via PBKDF2 (SHA-256, 600k
// rounds). Locked files can only be opened again with ScanOnce.

const MAGIC = new TextEncoder().encode("SCANONCE-LOCK1\n");
const ITERATIONS = 600_000;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function lockBytes(content: Uint8Array, fileName: string, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const header = new TextEncoder().encode(JSON.stringify({ name: fileName }));
  const plain = new Uint8Array(4 + header.length + content.length);
  new DataView(plain.buffer).setUint32(0, header.length);
  plain.set(header, 4);
  plain.set(content, 4 + header.length);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: MAGIC }, key, plain));
  const out = new Uint8Array(MAGIC.length + salt.length + iv.length + cipher.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + 16);
  out.set(cipher, MAGIC.length + 28);
  return out;
}

export function isLocked(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length + 28 && MAGIC.every((b, i) => bytes[i] === b);
}

export class WrongPassword extends Error {
  constructor() {
    super("That password is not correct.");
  }
}

export async function unlockBytes(bytes: Uint8Array, password: string): Promise<{ name: string; content: Uint8Array }> {
  if (!isLocked(bytes)) throw new Error("This is not a ScanOnce locked file.");
  const salt = bytes.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = bytes.subarray(MAGIC.length + 16, MAGIC.length + 28);
  const key = await deriveKey(password, salt);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: MAGIC }, key, bytes.subarray(MAGIC.length + 28) as BufferSource)
    );
  } catch {
    throw new WrongPassword();
  }
  const len = new DataView(plain.buffer).getUint32(0);
  const { name } = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + len)));
  return { name, content: plain.subarray(4 + len) };
}
