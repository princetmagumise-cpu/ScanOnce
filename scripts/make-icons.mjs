// Draws the app icon without any image libraries and writes PNG + SVG files
// to public/. Run with: npm run icons
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const TEAL = [15, 91, 84];
const WHITE = [255, 255, 255];
const MINT = [45, 212, 191];
const FOLD = [205, 226, 222];

// Shapes in a 0..1 coordinate space; later shapes paint over earlier ones.
function roundRect(x, y, w, h, r) {
  return (px, py) => {
    const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
    const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r <= 0;
  };
}
const page = (px, py) => roundRect(0.3, 0.2, 0.4, 0.6, 0.03)(px, py) && !(px + (0.8 - py) > 0.62 + 0.8 - 0.2 && px > 0.58 && py < 0.32);
const fold = (px, py) => px > 0.58 && py < 0.32 && py > 0.2 && px < 0.7 && px - 0.58 <= py - 0.2;
const line = (y, x1) => roundRect(0.36, y, x1 - 0.36, 0.035, 0.017);
const scan = roundRect(0.2, 0.555, 0.6, 0.05, 0.025);

function color(px, py, maskable) {
  const bg = maskable ? () => true : roundRect(0.03, 0.03, 0.94, 0.94, 0.22);
  if (!bg(px, py)) return null;
  // Maskable icons need the artwork inside the central safe zone.
  if (maskable) { px = (px - 0.5) / 0.8 + 0.5; py = (py - 0.5) / 0.8 + 0.5; }
  if (scan(px, py)) return MINT;
  if (fold(px, py)) return FOLD;
  if (page(px, py)) {
    if (line(0.36, 0.62)(px, py) || line(0.43, 0.6)(px, py) || line(0.5, 0.55)(px, py) || line(0.66, 0.62)(px, py) || line(0.73, 0.52)(px, py)) return FOLD;
    return WHITE;
  }
  return TEAL;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, maskable, opaque) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = color((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, maskable) ?? (opaque ? TEAL : null);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / n) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public", { recursive: true });
writeFileSync("public/icon-192.png", png(192, false, false));
writeFileSync("public/icon-512.png", png(512, true, true));
// iOS ignores transparency and wants a full square; it rounds the corners itself.
writeFileSync("public/apple-touch-icon.png", png(180, true, true));
writeFileSync("public/icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="3" y="3" width="94" height="94" rx="22" fill="#0f5b54"/>
  <path d="M33 20h25l12 12v45a3 3 0 0 1-3 3H33a3 3 0 0 1-3-3V23a3 3 0 0 1 3-3z" fill="#fff"/>
  <path d="M58 20v12h12z" fill="#cde2de"/>
  <g fill="#cde2de"><rect x="36" y="36" width="26" height="3.5" rx="1.7"/><rect x="36" y="43" width="24" height="3.5" rx="1.7"/><rect x="36" y="66" width="26" height="3.5" rx="1.7"/><rect x="36" y="73" width="16" height="3.5" rx="1.7"/></g>
  <rect x="20" y="55.5" width="60" height="5" rx="2.5" fill="#2dd4bf"/>
</svg>
`);
console.log("icons written");
