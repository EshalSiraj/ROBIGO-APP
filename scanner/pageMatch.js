// screens/pageMatch.js
//
// "Is this the same page as one I already scanned?" — by FEATURE MATCHING.
//
// The photo is reduced to a few hundred distinctive points (corners of pen
// strokes, letters, ink marks), each with a 256-bit description of the
// pattern around it (FAST corners + BRIEF descriptors, the classic method
// behind document/image matching). Two photos of the same page share many
// points that also sit in the same arrangement, even when the second photo is
// closer, further away, shifted, tilted, a bit skewed, partly cut off or
// darker. Different pages — even identical ruled register pages — don't.
//
// Pure JS, no React Native imports, so it is tested in Node (tests/pageMatch.test.mjs).

export const MATCH = {
  WIDTH: 440, // features are found on the photo shrunk to this width
  FAST_T: 18, // corner contrast threshold (0-255)
  MAX_POINTS: 500, // strongest points kept per photo (all zoom levels)
  LEVELS: 4, // zoom levels, each 1.25x smaller: handles closer/further re-shots (up to ~2x)
  LEVEL_SCALE: 1.25,
  ANGLE_BINS: 30, // point orientation in 12° steps: handles tilted re-shots
  GRID: 8, // spread points over an 8x8 grid so one busy area can't take them all
  PATCH: 13, // descriptor patch radius
  MAX_HAMMING: 80, // of 256 bits: max difference for a point match (v7: 70 -> 80, dense text)
  RATIO: 0.92, // best match must be clearly better than the second best (v7: 0.85 -> 0.92)
  RANSAC_ITERS: 400,
  INLIER_PX: 6, // matched points must land within 6 px after aligning
  // Tests: same page (moved, closer, further, tilted, angled, darker, soft, half
  // in view) 7-187 matching points; 12 different register pages: at most 3.
  // v7 (dense text, 500 points): same page at least 11, median 38; different pages at most 4.
  SAME_PAGE_INLIERS: 10, // this many consistent matches = same page, for sure
  MAYBE_PAGE_INLIERS: 6, // 6-9 = probably the same page: ask the teacher
};

// ---------------------------------------------------------------- helpers

function resize(gray, w, h, W) {
  if (w === W) return { img: gray, w, h };
  const s = w / W;
  const H = Math.round(h / s);
  const out = new Uint8Array(W * H);
  // source column range for every output column (computed once)
  const xs0 = new Int32Array(W);
  const xs1 = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    xs0[x] = Math.floor(x * s);
    xs1[x] = Math.max(xs0[x] + 1, Math.min(w, Math.floor((x + 1) * s)));
  }
  const acc = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    const sy0 = Math.floor(y * s);
    const sy1 = Math.max(sy0 + 1, Math.min(h, Math.floor((y + 1) * s)));
    acc.fill(0);
    for (let yy = sy0; yy < sy1; yy++) {
      const row = yy * w;
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let xx = xs0[x]; xx < xs1[x]; xx++) sum += gray[row + xx];
        acc[x] += sum;
      }
    }
    const rows = sy1 - sy0;
    for (let x = 0; x < W; x++) out[y * W + x] = acc[x] / (rows * (xs1[x] - xs0[x]));
  }
  return { img: out, w: W, h: H };
}

// FAST-9 circle of 16 pixels (radius 3)
const CIRCLE = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
];

const RING = new Int16Array(32);
let ringW = -1;
const RING_OFF = new Int32Array(16);

/** FAST-9 corner score (0 = not a corner). Circle offsets are cached per image width. */
function fastScore(img, w, x, y, t) {
  if (ringW !== w) {
    for (let i = 0; i < 16; i++) RING_OFF[i] = CIRCLE[i][1] * w + CIRCLE[i][0];
    ringW = w;
  }
  const c = y * w + x;
  const p = img[c];
  for (let i = 0; i < 16; i++) {
    const d = img[c + RING_OFF[i]] - p;
    RING[i] = d;
    RING[i + 16] = d;
  }
  // 9 contiguous brighter (d > t) or darker (d < -t) pixels on the circle
  let runB = 0;
  let runD = 0;
  let found = false;
  for (let i = 0; i < 25; i++) {
    const d = RING[i];
    if (d > t) { runB++; runD = 0; } else if (d < -t) { runD++; runB = 0; } else { runB = 0; runD = 0; }
    if (runB >= 9 || runD >= 9) { found = true; break; }
  }
  if (!found) return 0;
  let sc = 0;
  for (let i = 0; i < 16; i++) {
    const d = RING[i] < 0 ? -RING[i] - t : RING[i] - t;
    if (d > 0) sc += d;
  }
  return sc;
}

// Fixed random BRIEF pairs (same on every phone and every run).
const PAIRS = (() => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const g = () => {
    // roughly Gaussian, sigma ~ PATCH/2.5, clamped to the patch
    const v = (rnd() + rnd() + rnd() + rnd() - 2) * (MATCH.PATCH / 1.4);
    return Math.max(-MATCH.PATCH, Math.min(MATCH.PATCH, Math.round(v)));
  };
  const out = new Int8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = g();
    out[i * 4 + 1] = g();
    out[i * 4 + 2] = g();
    out[i * 4 + 3] = g();
  }
  return out;
})();

// The same pairs rotated to each orientation bin ("steered BRIEF").
const STEERED = (() => {
  const out = [];
  for (let b = 0; b < MATCH.ANGLE_BINS; b++) {
    const a = (b / MATCH.ANGLE_BINS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = new Int8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      for (let k = 0; k < 2; k++) {
        const x = PAIRS[i * 4 + k * 2];
        const y = PAIRS[i * 4 + k * 2 + 1];
        r[i * 4 + k * 2] = Math.round(c * x - s * y);
        r[i * 4 + k * 2 + 1] = Math.round(s * x + c * y);
      }
    }
    out.push(r);
  }
  return out;
})();

// Circle offsets for the orientation (intensity centroid, radius PATCH).
const DISC = (() => {
  const pts = [];
  const R = MATCH.PATCH;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= R * R) pts.push(x, y);
  return Int8Array.from(pts);
})();

// --------------------------------------------------------------- features

/** Points on one zoom level: [score, x, y] after non-maximum suppression. */
function detectLevel(img, W, H, border, wanted) {
  const G = MATCH.GRID;
  const perCell = Math.max(2, Math.ceil(wanted / (G * G)) * 2);
  const cells = Array.from({ length: G * G }, () => []);
  const score = new Float32Array(W * H);
  const t = MATCH.FAST_T;
  const W3 = 3 * W;
  for (let y = border; y < H - border; y++) {
    const row = y * W;
    for (let x = border; x < W - border; x++) {
      // Standard FAST quick test: of the 4 pixels up/right/down/left, at least
      // 3 must be clearly brighter or 3 clearly darker. Paper, straight ruled
      // lines and straight strokes stop here.
      const i = row + x;
      const p = img[i];
      const hi = p + t;
      const lo = p - t;
      const a = img[i - W3];
      const b = img[i + 3];
      const c = img[i + W3];
      const d = img[i - 3];
      const nb = (a > hi) + (b > hi) + (c > hi) + (d > hi);
      if (nb < 3 && (a < lo) + (b < lo) + (c < lo) + (d < lo) < 3) continue;
      score[i] = fastScore(img, W, x, y, t);
    }
  }
  for (let y = border; y < H - border; y++) {
    for (let x = border; x < W - border; x++) {
      const s = score[y * W + x];
      if (s <= 0) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && score[(y + dy) * W + x + dx] > s) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      const cell = Math.min(G - 1, Math.floor((y / H) * G)) * G + Math.min(G - 1, Math.floor((x / W) * G));
      cells[cell].push([s, x, y]);
    }
  }
  let pts = [];
  for (const c of cells) {
    c.sort((a, b) => b[0] - a[0]);
    pts.push(...c.slice(0, perCell));
  }
  pts.sort((a, b) => b[0] - a[0]);
  return pts.slice(0, wanted);
}

/**
 * Find feature points in a greyscale photo, on several zoom levels, each with
 * an orientation. Returns { n, xs, ys, desc: Uint32Array(n*8), w }
 * (coordinates in the MATCH.WIDTH-wide image).
 */
export function extractFeatures(gray, w, h) {
  const base = resize(gray, w, h, Math.min(MATCH.WIDTH, w));
  const border = Math.ceil(MATCH.PATCH * 1.45) + 5; // rotated pairs reach PATCH*sqrt(2), plus the 5x5 box
  // points per level, fewer on the smaller levels
  const weights = [];
  for (let l = 0; l < MATCH.LEVELS; l++) weights.push(Math.pow(1 / MATCH.LEVEL_SCALE, l));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const all = [];
  let lv = base;
  for (let l = 0; l < MATCH.LEVELS; l++) {
    const scale = Math.pow(MATCH.LEVEL_SCALE, l);
    const lw = Math.round(base.w / scale);
    if (lw < 4 * border) break;
    if (l > 0) lv = resize(lv.img, lv.w, lv.h, lw); // each level from the previous one
    // Integral image: 5x5 box means only where the descriptor looks (much
    // cheaper than smoothing the whole picture).
    const LW = lv.w;
    const W1 = LW + 1;
    const integ = new Uint32Array(W1 * (lv.h + 1));
    for (let yy = 0; yy < lv.h; yy++) {
      let rowSum = 0;
      const src = yy * LW;
      const dst = (yy + 1) * W1;
      const up = yy * W1;
      for (let xx = 0; xx < LW; xx++) {
        rowSum += lv.img[src + xx];
        integ[dst + xx + 1] = integ[up + xx + 1] + rowSum;
      }
    }
    const box = (xx, yy) =>
      integ[(yy + 3) * W1 + xx + 3] - integ[(yy - 2) * W1 + xx + 3] - integ[(yy + 3) * W1 + xx - 2] + integ[(yy - 2) * W1 + xx - 2];
    const pts = detectLevel(lv.img, lv.w, lv.h, border, Math.round((MATCH.MAX_POINTS * weights[l]) / wsum));
    const sx = base.w / lv.w; // exact scale back to level 0
    for (const [, x, y] of pts) {
      // orientation from the intensity centroid
      let m10 = 0;
      let m01 = 0;
      for (let k = 0; k < DISC.length; k += 2) {
        const v = lv.img[(y + DISC[k + 1]) * LW + x + DISC[k]];
        m10 += DISC[k] * v;
        m01 += DISC[k + 1] * v;
      }
      let ang = Math.atan2(m01, m10);
      if (ang < 0) ang += Math.PI * 2;
      const bin = Math.round((ang / (Math.PI * 2)) * MATCH.ANGLE_BINS) % MATCH.ANGLE_BINS;
      const pairs = STEERED[bin];
      const d = new Uint32Array(8);
      for (let i = 0; i < 256; i++) {
        const a = box(x + pairs[i * 4], y + pairs[i * 4 + 1]);
        const b = box(x + pairs[i * 4 + 2], y + pairs[i * 4 + 3]);
        if (a < b) d[i >> 5] |= 1 << (i & 31);
      }
      all.push({ x: x * sx, y: y * sx, d });
    }
  }
  const n = all.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const desc = new Uint32Array(n * 8);
  all.forEach((p, k) => {
    xs[k] = p.x;
    ys[k] = p.y;
    desc.set(p.d, k * 8);
  });
  return { n, xs, ys, desc, w: base.w };
}

/**
 * The part of a greyscale photo that is the page (rect = fractions from
 * analyzePage). Returns { gray, w, h }; the whole photo if no page box was found.
 * Feature points are taken from the page only: the desk stays the same between
 * shots and would otherwise make two different pages look alike.
 */
export function cropGray(gray, w, h, rect) {
  if (!rect) return { gray, w, h };
  const x0 = Math.max(0, Math.floor(rect.x0 * w));
  const y0 = Math.max(0, Math.floor(rect.y0 * h));
  const x1 = Math.min(w, Math.ceil(rect.x1 * w));
  const y1 = Math.min(h, Math.ceil(rect.y1 * h));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 64 || ch < 64) return { gray, w, h };
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) out.set(gray.subarray((y0 + y) * w + x0, (y0 + y) * w + x1), y * cw);
  return { gray: out, w: cw, h: ch };
}

// ------------------------------------------------------- store / restore

function bytesToB64(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += A[(v >> 18) & 63] + A[(v >> 12) & 63] + A[(v >> 6) & 63] + A[v & 63];
  }
  if (i < bytes.length) {
    const v = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    out += A[(v >> 18) & 63] + A[(v >> 12) & 63] + (i + 1 < bytes.length ? A[(v >> 6) & 63] : '=') + '=';
  }
  return out;
}

function b64ToBytes(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const map = new Uint8Array(128);
  for (let i = 0; i < 64; i++) map[A.charCodeAt(i)] = i;
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v =
      (map[clean.charCodeAt(i)] << 18) |
      (map[clean.charCodeAt(i + 1)] << 12) |
      ((i + 2 < clean.length ? map[clean.charCodeAt(i + 2)] : 0) << 6) |
      (i + 3 < clean.length ? map[clean.charCodeAt(i + 3)] : 0);
    out[o++] = (v >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (v >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}

/** Compact text form for pages.json (~13 KB per page). */
export function encodeFeatures(f) {
  const bytes = new Uint8Array(4 + f.n * 36);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, f.n, true);
  dv.setUint16(2, f.w, true);
  for (let k = 0; k < f.n; k++) {
    const o = 4 + k * 36;
    dv.setUint16(o, Math.round(f.xs[k] * 4), true);
    dv.setUint16(o + 2, Math.round(f.ys[k] * 4), true);
    for (let j = 0; j < 8; j++) dv.setUint32(o + 4 + j * 4, f.desc[k * 8 + j], true);
  }
  return bytesToB64(bytes);
}

const decoded = new Map();
export function decodeFeatures(s) {
  if (!s) return null;
  const hit = decoded.get(s);
  if (hit) return hit;
  const bytes = b64ToBytes(s);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint16(0, true);
  const w = dv.getUint16(2, true);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const desc = new Uint32Array(n * 8);
  for (let k = 0; k < n; k++) {
    const o = 4 + k * 36;
    xs[k] = dv.getUint16(o, true) / 4;
    ys[k] = dv.getUint16(o + 2, true) / 4;
    for (let j = 0; j < 8; j++) desc[k * 8 + j] = dv.getUint32(o + 4 + j * 4, true);
  }
  const f = { n, xs, ys, desc, w };
  if (decoded.size > 300) decoded.clear();
  decoded.set(s, f);
  return f;
}

// --------------------------------------------------------------- matching

// Bits set in every 16-bit number (lookup is much faster than bit tricks on a phone).
const BITS16 = (() => {
  const t = new Uint8Array(65536);
  for (let i = 1; i < 65536; i++) t[i] = t[i >> 1] + (i & 1);
  return t;
})();

/** All point-to-point distances, computed once (A.n x B.n). */
function distanceMatrix(A, B) {
  const D = new Uint16Array(A.n * B.n);
  const da = A.desc;
  const db = B.desc;
  for (let i = 0; i < A.n; i++) {
    const a = i * 8;
    const a0 = da[a], a1 = da[a + 1], a2 = da[a + 2], a3 = da[a + 3], a4 = da[a + 4], a5 = da[a + 5], a6 = da[a + 6], a7 = da[a + 7];
    const row = i * B.n;
    for (let j = 0; j < B.n; j++) {
      const b = j * 8;
      let x = a0 ^ db[b];
      let d = BITS16[x & 0xffff] + BITS16[x >>> 16];
      x = a1 ^ db[b + 1]; d += BITS16[x & 0xffff] + BITS16[x >>> 16];
      x = a2 ^ db[b + 2]; d += BITS16[x & 0xffff] + BITS16[x >>> 16];
      x = a3 ^ db[b + 3]; d += BITS16[x & 0xffff] + BITS16[x >>> 16];
      if (d > MATCH.MAX_HAMMING + 40) { D[row + j] = 999; continue; } // clearly different: stop early
      x = a4 ^ db[b + 4]; d += BITS16[x & 0xffff] + BITS16[x >>> 16];
      x = a5 ^ db[b + 5]; d += BITS16[x & 0xffff] + BITS16[x >>> 16];
      x = a6 ^ db[b + 6]; d += BITS16[x & 0xffff] + BITS16[x >>> 16];
      x = a7 ^ db[b + 7]; d += BITS16[x & 0xffff] + BITS16[x >>> 16];
      D[row + j] = d;
    }
  }
  return D;
}

/** Best match per point with the ratio test, along rows (A->B) or columns (B->A). */
function bestMatches(D, nA, nB, rowsAreA) {
  const n = rowsAreA ? nA : nB;
  const m = rowsAreA ? nB : nA;
  const best = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let d1 = 999;
    let d2 = 999;
    let j1 = -1;
    for (let j = 0; j < m; j++) {
      const d = rowsAreA ? D[i * nB + j] : D[j * nB + i];
      if (d < d1) {
        d2 = d1;
        d1 = d;
        j1 = j;
      } else if (d < d2) d2 = d;
    }
    if (j1 >= 0 && d1 <= MATCH.MAX_HAMMING && d1 < d2 * MATCH.RATIO) best[i] = j1;
  }
  return best;
}

/**
 * Compare two feature sets. Returns { inliers, share } — how many matched
 * points agree on one consistent move/scale/rotation of the page.
 */
export function matchFeatures(A, B) {
  if (!A || !B || A.n < 8 || B.n < 8) return { inliers: 0, share: 0 };
  const D = distanceMatrix(A, B);
  const ab = bestMatches(D, A.n, B.n, true);
  const ba = bestMatches(D, A.n, B.n, false);
  const pairs = [];
  for (let i = 0; i < A.n; i++) {
    const j = ab[i];
    if (j >= 0 && ba[j] === i) pairs.push(i, j); // mutual best match
  }
  const m = pairs.length / 2;
  if (m < 6) return { inliers: m, share: m / Math.min(A.n, B.n) };

  // RANSAC: similarity transform (scale, rotation, shift) from 2 point pairs.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const tol2 = MATCH.INLIER_PX * MATCH.INLIER_PX;
  let bestCount = 0;
  for (let it = 0; it < MATCH.RANSAC_ITERS; it++) {
    const p = Math.floor(rnd() * m);
    let q = Math.floor(rnd() * m);
    if (q === p) q = (q + 1) % m;
    const ax1 = A.xs[pairs[2 * p]], ay1 = A.ys[pairs[2 * p]];
    const ax2 = A.xs[pairs[2 * q]], ay2 = A.ys[pairs[2 * q]];
    const bx1 = B.xs[pairs[2 * p + 1]], by1 = B.ys[pairs[2 * p + 1]];
    const bx2 = B.xs[pairs[2 * q + 1]], by2 = B.ys[pairs[2 * q + 1]];
    const dax = ax2 - ax1, day = ay2 - ay1, dbx = bx2 - bx1, dby = by2 - by1;
    const la = dax * dax + day * day;
    if (la < 400) continue; // points too close together
    // b = s*R*a + t  ->  [c -s; s c]
    const c = (dax * dbx + day * dby) / la;
    const s = (dax * dby - day * dbx) / la;
    const scale = Math.hypot(c, s);
    if (scale < 0.4 || scale > 2.5) continue; // not a believable re-shot
    if (Math.abs(Math.atan2(s, c)) > 0.6) continue; // more than ~35° rotation
    const tx = bx1 - (c * ax1 - s * ay1);
    const ty = by1 - (s * ax1 + c * ay1);
    let count = 0;
    for (let k = 0; k < m; k++) {
      const ax = A.xs[pairs[2 * k]], ay = A.ys[pairs[2 * k]];
      const ex = c * ax - s * ay + tx - B.xs[pairs[2 * k + 1]];
      const ey = s * ax + c * ay + ty - B.ys[pairs[2 * k + 1]];
      if (ex * ex + ey * ey <= tol2 * scale * scale + tol2) count++;
    }
    if (count > bestCount) bestCount = count;
  }
  return { inliers: bestCount, share: bestCount / Math.min(A.n, B.n) };
}

/** 'same' | 'maybe' | null, from a matchFeatures() result. */
export function pageVerdict(result) {
  if (result.inliers >= MATCH.SAME_PAGE_INLIERS) return 'same';
  if (result.inliers >= MATCH.MAYBE_PAGE_INLIERS) return 'maybe';
  return null;
}

/** Same page for sure? */
export function isSamePage(result) {
  return pageVerdict(result) === 'same';
}