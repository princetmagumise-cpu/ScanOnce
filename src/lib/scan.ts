import { makeCanvas } from "./image";

export type Pt = { x: number; y: number };
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
export type Filter = "original" | "enhance" | "gray" | "bw";

export function fullQuad(w: number, h: number): Quad {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

// ---------- Automatic page detection ----------

function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/**
 * Finds a sheet of paper in a photo: the largest bright region, whose extreme
 * points give the four corners. Works well for a light page on a darker
 * surface; returns null when no convincing page is found.
 */
export function detectPage(src: HTMLCanvasElement): Quad | null {
  const S = 320;
  const scale = Math.min(1, S / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.filter = "blur(2px)";
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  const t = otsu(gray);

  // Largest 4-connected component of bright pixels.
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  let bestId = -1, bestSize = 0;
  for (let start = 0, id = 0; start < w * h; start++) {
    if (gray[start] <= t || label[start] !== -1) continue;
    let size = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of nb) {
        if (n >= 0 && label[n] === -1 && gray[n] > t) { label[n] = id; stack.push(n); }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const frac = bestSize / (w * h);
  if (bestId < 0 || frac < 0.15 || frac > 0.97) return null;

  let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity };
  let tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== bestId) continue;
    const x = i % w, y = (i / w) | 0;
    if (x + y < tl.v) tl = { x, y, v: x + y };
    if (x + y > br.v) br = { x, y, v: x + y };
    if (x - y > tr.v) tr = { x, y, v: x - y };
    if (x - y < bl.v) bl = { x, y, v: x - y };
  }
  const k = 1 / scale;
  const q: Quad = [tl, tr, br, bl].map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
  // Reject degenerate shapes (e.g. a thin strip).
  const wTop = dist(q[0], q[1]), hLeft = dist(q[0], q[3]);
  if (wTop < src.width * 0.2 || hLeft < src.height * 0.2) return null;
  return q;
}

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------- Perspective correction ----------

/** Solves the 8 homography coefficients mapping `from` (unit rect corners) to `to`. */
function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/** Warps the quadrilateral `q` of `src` into a flat rectangle. */
export function warp(src: HTMLCanvasElement, q: Quad, maxSide = 2600): HTMLCanvasElement {
  let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(1, Math.round(W * s));
  H = Math.max(1, Math.round(H * s));

  const isFull =
    q[0].x === 0 && q[0].y === 0 && q[1].x === src.width && q[2].y === src.height && q[3].x === 0 && q[1].y === 0;
  if (isFull) {
    const out = makeCanvas(W, H);
    out.getContext("2d")!.drawImage(src, 0, 0, W, H);
    return out;
  }

  const m = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], q);
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  const sw = src.width, sh = src.height;
  const sp = sctx.getImageData(0, 0, sw, sh).data;
  const out = makeCanvas(W, H);
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(W, H);
  const dp = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = m[6] * x + m[7] * y + 1;
      const u = (m[0] * x + m[1] * y + m[2]) / den;
      const v = (m[3] * x + m[4] * y + m[5]) / den;
      const x0 = Math.min(sw - 2, Math.max(0, Math.floor(u)));
      const y0 = Math.min(sh - 2, Math.max(0, Math.floor(v)));
      const fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sp[i00 + ch] * (1 - fx) + sp[i10 + ch] * fx;
        const bot = sp[i01 + ch] * (1 - fx) + sp[i11 + ch] * fx;
        dp[o + ch] = top * (1 - fy) + bot * fy;
      }
      dp[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ---------- Filters ----------

export function applyFilter(src: HTMLCanvasElement, filter: Filter): HTMLCanvasElement {
  if (filter === "original") return src;
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const n = out.width * out.height;

  if (filter === "enhance") {
    // Stretch each channel between its 1st and 99th percentile, then lift whites.
    for (let ch = 0; ch < 3; ch++) {
      const hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) hist[d[i * 4 + ch]]++;
      let lo = 0, hi = 255, acc = 0;
      for (; lo < 255 && (acc += hist[lo]) < n * 0.01; lo++);
      acc = 0;
      for (; hi > 0 && (acc += hist[hi]) < n * 0.01; hi--);
      const span = Math.max(1, hi - lo);
      for (let i = 0; i < n; i++) {
        const v = ((d[i * 4 + ch] - lo) / span) * 255;
        d[i * 4 + ch] = v > 235 ? 255 : v;
      }
    }
  } else {
    const gray = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) gray[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    if (filter === "gray") {
      for (let i = 0; i < n; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = gray[i];
    } else {
      // Adaptive threshold (Bradley): compare each pixel with its neighbourhood
      // mean so shadows and uneven lighting don't swallow the text.
      const w = out.width, h = out.height;
      const integral = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
          row += gray[y * w + x];
          integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
        }
      }
      const r = Math.max(8, Math.round(Math.max(w, h) / 32));
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
          const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
          const mean = sum / ((x1 - x0) * (y1 - y0));
          const v = gray[y * w + x] < mean * 0.88 ? 0 : 255;
          const i = (y * w + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
