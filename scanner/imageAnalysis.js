// screens/imageAnalysis.js
//
// Pure image maths (no React Native imports) so it can be unit-tested in Node.
// Works on a small greyscale copy of the captured photo (about 640 px wide):
//
//   findPageRect      where the sheet of paper is (so we can crop the desk away)
//   blurScore         how sharp the writing is, 0 (blurry) .. 1 (sharp)
//   pageFingerprint   a tiny "picture summary" used to spot the same page twice
//   fingerprintSimilarity   compare two fingerprints, 1 = identical
//
// Why not ImageManipulator? Expo's ImageRef has no getPixels(), so the old code
// threw on every capture and silently skipped the blur, crop and duplicate checks.
// We now decode a small JPEG with jpeg-js (pure JS) and work on the raw pixels.

export const ANALYSIS = {
  WIDTH: 640, // analysis image width in px

  // Page detection
  MIN_CONTRAST: 35, // paper must be this much brighter than the background (0-255)
  ROW_PAPER_FRACTION: 0.6, // a row/column "is paper" if this much of it is bright
  MAX_GAP: 0.08, // dark bands up to 8% of the photo (header bars) don't split the page
  MIN_PAGE_AREA: 0.25, // detected page must cover >= 25% of the photo
  CROP_MARGIN: 0.012, // keep a thin border so no writing at the edge is cut

  // Blur (re-blur method, Crete-Roffet et al. 2007)
  REBLUR_R: 1, // re-blur with a 3-tap box: handwriting strokes are only 1-3 px wide here
  EDGE_MIN: 10, // only measure at real ink edges, not paper noise
  MIN_EDGE_PIXELS: 200, // fewer edges than this = blank page, blur unknown

  // Fingerprint
  FP_W: 24,
  FP_H: 34,
  SHIFT: 1, // each region may move 1 cell (small framing differences)
  MAX_SKEW_DEG: 6, // page tilt we straighten out before fingerprinting
  MAX_INK_POINTS: 8000, // ink pixels used to measure the tilt (speed)
  REGIONS: 3, // page split into REGIONS x REGIONS blocks for the comparison
  ALIGN_SCALES: [0.82, 0.88, 0.94, 1, 1.06, 1.13, 1.2], // closer / further re-shots
  ALIGN_SHIFT: 4, // cells
};

// --------------------------------------------------------------------------
// Decoding helpers
// --------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // url-safe variants
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** base64 string -> Uint8Array (no Buffer needed, works in Hermes). */
export function base64ToBytes(b64) {
  const clean = b64.replace(/^data:[^,]*,/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean.charCodeAt(i)];
    if (v === 255) continue; // skip '=', newlines
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** RGBA bytes -> greyscale Uint8Array (one byte per pixel). */
export function rgbaToGray(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return g;
}

// --------------------------------------------------------------------------
// Page detection: paper is the big bright area; desk/background is darker.
// --------------------------------------------------------------------------

/** Otsu threshold + how far apart the dark and bright groups are. */
export function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let threshold = 127;
  let meanDark = 0;
  let meanBright = 255;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
      meanDark = mB;
      meanBright = mF;
    }
  }
  return { threshold, contrast: meanBright - meanDark };
}

/**
 * Longest stretch of rows (or columns) that are "paper", allowing short gaps
 * (a dark printed header bar or a thick line of writing must not split the page).
 */
function longestRun(fracs, minFrac, maxGap) {
  let best = null;
  let start = -1;
  let lastOn = -1;
  for (let i = 0; i <= fracs.length; i++) {
    const on = i < fracs.length && fracs[i] >= minFrac;
    if (on) {
      if (start < 0) start = i;
      lastOn = i;
    } else if (start >= 0 && (i - lastOn > maxGap || i === fracs.length)) {
      if (!best || lastOn + 1 - start > best[1] - best[0]) best = [start, lastOn + 1];
      start = -1;
    }
  }
  return best;
}

/**
 * Returns the page as fractions of the image { x0, y0, x1, y1 } (0..1),
 * or null when there is no clear page (then the caller keeps the full photo).
 * Never returns a crop that would cut into the paper: it adds a small margin.
 */
export function findPageRect(gray, w, h) {
  const { threshold, contrast } = otsu(gray);
  if (contrast < ANALYSIS.MIN_CONTRAST) return null; // paper on white desk etc.

  // Rows first (full width), then columns inside those rows.
  const rowFrac = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) if (gray[row + x] > threshold) n++;
    rowFrac[y] = n / w;
  }
  // A row crossing the page is only partly paper when the page is narrower than
  // the photo, so use a lower bar for rows and refine with columns.
  const rows = longestRun(rowFrac, 0.3, Math.round(h * ANALYSIS.MAX_GAP));
  if (!rows) return null;
  const [y0, y1] = rows;

  const colFrac = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = y0; y < y1; y++) if (gray[y * w + x] > threshold) n++;
    colFrac[x] = n / (y1 - y0);
  }
  const cols = longestRun(colFrac, ANALYSIS.ROW_PAPER_FRACTION, Math.round(w * ANALYSIS.MAX_GAP));
  if (!cols) return null;
  const [x0, x1] = cols;

  // Re-measure rows inside the page columns for a tight top/bottom.
  const rowFrac2 = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    const row = y * w;
    for (let x = x0; x < x1; x++) if (gray[row + x] > threshold) n++;
    rowFrac2[y] = n / (x1 - x0);
  }
  const rows2 = longestRun(rowFrac2, ANALYSIS.ROW_PAPER_FRACTION, Math.round(h * ANALYSIS.MAX_GAP)) || rows;

  const m = ANALYSIS.CROP_MARGIN;
  const rect = {
    x0: Math.max(0, x0 / w - m),
    y0: Math.max(0, rows2[0] / h - m),
    x1: Math.min(1, x1 / w + m),
    y1: Math.min(1, rows2[1] / h + m),
  };
  const area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
  if (area < ANALYSIS.MIN_PAGE_AREA) return null;
  // Nothing to crop: page already fills the photo.
  if (rect.x0 < 0.02 && rect.y0 < 0.02 && rect.x1 > 0.98 && rect.y1 > 0.98) return null;
  return rect;
}

function pixelBox(rect, w, h, inset = 0) {
  const r = rect || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const iw = (r.x1 - r.x0) * inset;
  const ih = (r.y1 - r.y0) * inset;
  return {
    x0: Math.max(0, Math.floor((r.x0 + iw) * w)),
    y0: Math.max(0, Math.floor((r.y0 + ih) * h)),
    x1: Math.min(w, Math.ceil((r.x1 - iw) * w)),
    y1: Math.min(h, Math.ceil((r.y1 - ih) * h)),
  };
}

// --------------------------------------------------------------------------
// Blur: blur the image a bit more and see how much the edges change.
// Sharp writing loses a lot of edge strength; already-blurry writing barely
// changes. Result does not depend on how much is written on the page.
// --------------------------------------------------------------------------

/** Returns 0 (very blurry) .. 1 (very sharp), or null for a blank page. */
export function blurScore(gray, w, h, rect) {
  const b = pixelBox(rect, w, h, 0.04);
  const R = ANALYSIS.REBLUR_R;
  let sumDh = 0;
  let sumVh = 0;
  let sumDv = 0;
  let sumVv = 0;
  let edges = 0;

  // Horizontal direction (every 2nd row is enough)
  for (let y = b.y0; y < b.y1; y += 2) {
    const row = y * w;
    // running box sum along the row
    let acc = 0;
    const blur = new Float32Array(b.x1 - b.x0);
    for (let x = b.x0 - R; x <= b.x0 + R; x++) acc += gray[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = b.x0; x < b.x1; x++) {
      blur[x - b.x0] = acc / (2 * R + 1);
      acc += gray[row + Math.min(w - 1, x + R + 1)] - gray[row + Math.max(0, x - R)];
    }
    for (let x = b.x0; x < b.x1 - 1; x++) {
      const dF = Math.abs(gray[row + x + 1] - gray[row + x]);
      if (dF < ANALYSIS.EDGE_MIN) continue;
      edges++;
      const dB = Math.abs(blur[x + 1 - b.x0] - blur[x - b.x0]);
      sumDh += dF;
      sumVh += Math.max(0, dF - dB);
    }
  }
  // Vertical direction (every 2nd column)
  for (let x = b.x0; x < b.x1; x += 2) {
    let acc = 0;
    const blur = new Float32Array(b.y1 - b.y0);
    for (let y = b.y0 - R; y <= b.y0 + R; y++) acc += gray[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = b.y0; y < b.y1; y++) {
      blur[y - b.y0] = acc / (2 * R + 1);
      acc += gray[Math.min(h - 1, y + R + 1) * w + x] - gray[Math.max(0, y - R) * w + x];
    }
    for (let y = b.y0; y < b.y1 - 1; y++) {
      const dF = Math.abs(gray[(y + 1) * w + x] - gray[y * w + x]);
      if (dF < ANALYSIS.EDGE_MIN) continue;
      edges++;
      const dB = Math.abs(blur[y + 1 - b.y0] - blur[y - b.y0]);
      sumDv += dF;
      sumVv += Math.max(0, dF - dB);
    }
  }
  if (edges < ANALYSIS.MIN_EDGE_PIXELS || sumDh === 0 || sumDv === 0) return null;
  // Use the worse direction: motion blur often affects only one.
  return Math.min(sumVh / sumDh, sumVv / sumDv);
}

// --------------------------------------------------------------------------
// Tilt: the angle at which the rows of writing / ruled lines line up best.
// --------------------------------------------------------------------------

/** Page tilt in radians (positive = clockwise in the photo). 0 if unsure. */
export function estimateSkew(gray, w, h, rect) {
  const b = pixelBox(rect, w, h, 0.05);
  // Ink = clearly darker than this page's paper.
  let sum = 0;
  let n = 0;
  for (let y = b.y0; y < b.y1; y += 4) for (let x = b.x0; x < b.x1; x += 4) { sum += gray[y * w + x]; n++; }
  const inkBelow = (sum / Math.max(1, n)) * 0.75;
  const xs = [];
  const ys = [];
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  // Every row (so 0° gets no unfair advantage), every 2nd column for speed.
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0 + (y & 1); x < b.x1; x += 2) {
      if (gray[y * w + x] < inkBelow) { xs.push(x - cx); ys.push(y - cy); }
    }
  }
  if (xs.length < 300) return 0;
  // Keep at most MAX_INK_POINTS evenly spread points: plenty for the angle.
  if (xs.length > ANALYSIS.MAX_INK_POINTS) {
    const step = xs.length / ANALYSIS.MAX_INK_POINTS;
    const nx = [];
    const ny = [];
    for (let k = 0; k < xs.length; k += step) { nx.push(xs[k | 0]); ny.push(ys[k | 0]); }
    xs.length = 0; ys.length = 0;
    xs.push(...nx); ys.push(...ny);
  }
  const maxDeg = ANALYSIS.MAX_SKEW_DEG;
  const bins = Math.ceil(Math.hypot(b.x1 - b.x0, b.y1 - b.y0)) + 4;
  const hist = new Float64Array(bins);
  const score = (deg) => {
    const a = (deg * Math.PI) / 180;
    const sn = Math.sin(a);
    const cs = Math.cos(a);
    hist.fill(0);
    for (let i = 0; i < xs.length; i++) {
      const v = Math.round((-xs[i] * sn + ys[i] * cs) / 2 + bins / 2); // 2 px bins
      if (v >= 0 && v < bins) hist[v]++;
    }
    let s2 = 0;
    for (let i = 0; i < bins; i++) s2 += hist[i] * hist[i];
    return s2;
  };
  // Coarse search, then fine search around the best angle.
  let best = 0;
  let bestScore = -1;
  for (let d = -maxDeg; d <= maxDeg; d += 0.5) {
    const sc = score(d);
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  const coarse = best;
  for (let d = coarse - 0.5; d <= coarse + 0.5; d += 0.1) {
    const sc = score(d);
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  return (best * Math.PI) / 180;
}

// --------------------------------------------------------------------------
// Fingerprint: the (straightened) page shrunk to FP_W x FP_H cells, with slow
// lighting changes removed so the same page under different light still matches.
// --------------------------------------------------------------------------

/**
 * Centre and size of the page measured along its own (tilted) axes, so the
 * fingerprint grid sits on the page the same way however the photo was framed.
 */
export function pageFrame(gray, w, h, rect, skew) {
  const full = { cx: w / 2, cy: h / 2, pw: w, ph: h };
  if (!rect) return full;
  const { threshold } = otsu(gray);
  const ca = Math.cos(skew);
  const sa = Math.sin(skew);
  const b = pixelBox(rect, w, h, -0.03); // look slightly beyond the box
  const cx0 = (b.x0 + b.x1) / 2;
  const cy0 = (b.y0 + b.y1) / 2;
  const span = Math.ceil(Math.hypot(w, h));
  const off = span;
  const hu = new Float32Array(2 * span + 1);
  const hv = new Float32Array(2 * span + 1);
  for (let y = b.y0; y < b.y1; y += 2) {
    for (let x = b.x0; x < b.x1; x += 2) {
      if (gray[y * w + x] <= threshold) continue;
      const dx = x - cx0;
      const dy = y - cy0;
      hu[Math.round(dx * ca + dy * sa) + off]++;
      hv[Math.round(-dx * sa + dy * ca) + off]++;
    }
  }
  const extent = (hist) => {
    let max = 0;
    for (let i = 0; i < hist.length; i++) if (hist[i] > max) max = hist[i];
    // Smooth over 5 bins (sampling every 2 px leaves gaps)
    const lim = max * 0.35;
    let lo = -1;
    let hi = -1;
    for (let i = 2; i < hist.length - 2; i++) {
      const v = (hist[i - 2] + hist[i - 1] + hist[i] + hist[i + 1] + hist[i + 2]) / 5;
      if (v >= lim) {
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    return lo < 0 ? null : [lo - off, hi - off];
  };
  const eu = extent(hu);
  const ev = extent(hv);
  if (!eu || !ev) return full;
  const uc = (eu[0] + eu[1]) / 2;
  const vc = (ev[0] + ev[1]) / 2;
  return {
    cx: cx0 + uc * ca - vc * sa,
    cy: cy0 + uc * sa + vc * ca,
    pw: eu[1] - eu[0],
    ph: ev[1] - ev[0],
  };
}

/**
 * Centre and size of the WRITTEN AREA (all ink: header, ruled lines, writing),
 * measured along the page's own tilted axes. Unlike the paper edges, this is
 * the same whether the photo was taken close up (no desk visible) or from
 * further away, so the same page always gives the same fingerprint.
 * Returns null when there is too little ink.
 */
export function contentFrame(gray, w, h, rect, skew) {
  const b = pixelBox(rect, w, h, rect ? 0.015 : 0.005);
  // Paper brightness = 80th percentile of the area; ink = clearly darker.
  const hist = new Uint32Array(256);
  let total = 0;
  for (let y = b.y0; y < b.y1; y += 3) for (let x = b.x0; x < b.x1; x += 3) { hist[gray[y * w + x]]++; total++; }
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.8) { paper = v; break; } }
  const inkBelow = paper * 0.72;
  const ca = Math.cos(skew);
  const sa = Math.sin(skew);
  const cx0 = (b.x0 + b.x1) / 2;
  const cy0 = (b.y0 + b.y1) / 2;
  const us = [];
  const vs = [];
  // Only THIN dark marks count as writing: paper on both sides within D px.
  // Dark desk areas (e.g. corners next to a tilted page) are not thin, so they
  // are ignored.
  const D = 6;
  const paperAbove = paper * 0.85;
  const bright = (x, y) => x >= 0 && x < w && y >= 0 && y < h && gray[y * w + x] >= paperAbove;
  for (let y = b.y0; y < b.y1; y += 2) {
    for (let x = b.x0 + (y & 2 ? 1 : 0); x < b.x1; x += 2) {
      if (gray[y * w + x] >= inkBelow) continue;
      const thin = (bright(x - D, y) && bright(x + D, y)) || (bright(x, y - D) && bright(x, y + D));
      if (!thin) continue;
      const dx = x - cx0;
      const dy = y - cy0;
      us.push(dx * ca + dy * sa);
      vs.push(-dx * sa + dy * ca);
    }
  }
  if (us.length < 200) return null;
  const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];
  us.sort((a, c) => a - c);
  vs.sort((a, c) => a - c);
  const u0 = pct(us, 0.005);
  const u1 = pct(us, 0.995);
  const v0 = pct(vs, 0.005);
  const v1 = pct(vs, 0.995);
  if (u1 - u0 < w * 0.15 || v1 - v0 < h * 0.15) return null;
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  return { cx: cx0 + uc * ca - vc * sa, cy: cy0 + uc * sa + vc * ca, pw: u1 - u0, ph: v1 - v0 };
}

export function pageFingerprint(gray, w, h, rect, skew = estimateSkew(gray, w, h, rect)) {
  const { FP_W, FP_H } = ANALYSIS;
  // Measure the grid on the written area (same for close and far photos);
  // fall back to the paper edges when there is hardly any ink.
  const content = contentFrame(gray, w, h, rect, skew);
  const frame = content || pageFrame(gray, w, h, rect, skew);
  const { cx, cy } = frame;
  const pw = content ? frame.pw * 1.02 : frame.pw * 0.96;
  const ph = content ? frame.ph * 1.02 : frame.ph * 0.96;
  const ca = Math.cos(skew);
  const sa = Math.sin(skew);
  // Integral image: average any small box in O(1), so thin pen strokes and
  // ruled lines are averaged instead of being hit-or-missed by single pixels.
  const W1 = w + 1;
  const integ = new Uint32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + rowSum;
    }
  }
  const S = 3; // 3x3 sample boxes per cell
  const r = Math.max(1, Math.round(pw / FP_W / S / 2));
  const boxMean = (x, y) => {
    const xa = Math.max(0, x - r);
    const ya = Math.max(0, y - r);
    const xb = Math.min(w, x + r + 1);
    const yb = Math.min(h, y + r + 1);
    if (xb <= xa || yb <= ya) return -1;
    const sum = integ[yb * W1 + xb] - integ[ya * W1 + xb] - integ[yb * W1 + xa] + integ[ya * W1 + xa];
    return sum / ((xb - xa) * (yb - ya));
  };
  const cells = new Float32Array(FP_W * FP_H);
  for (let cyI = 0; cyI < FP_H; cyI++) {
    for (let cxI = 0; cxI < FP_W; cxI++) {
      let s = 0;
      let n = 0;
      for (let sy = 0; sy < S; sy++) {
        const v = ((cyI + (sy + 0.5) / S) / FP_H - 0.5) * ph;
        for (let sx = 0; sx < S; sx++) {
          const u = ((cxI + (sx + 0.5) / S) / FP_W - 0.5) * pw;
          const m = boxMean(Math.round(cx + u * ca - v * sa), Math.round(cy + u * sa + v * ca));
          if (m >= 0) { s += m; n++; }
        }
      }
      cells[cyI * FP_W + cxI] = n ? s / n : 0;
    }
  }
  // Remove lighting: subtract each cell's 5x5 neighbourhood mean.
  const hp = new Float32Array(cells.length);
  for (let cyI = 0; cyI < FP_H; cyI++) {
    for (let cxI = 0; cxI < FP_W; cxI++) {
      let s = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = cyI + dy;
        if (yy < 0 || yy >= FP_H) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = cxI + dx;
          if (xx < 0 || xx >= FP_W) continue;
          s += cells[yy * FP_W + xx];
          n++;
        }
      }
      hp[cyI * FP_W + cxI] = cells[cyI * FP_W + cxI] - s / n;
    }
  }
  // Store as signed bytes in hex (2 chars per cell) so it fits in pages.json.
  let hex = '';
  for (let i = 0; i < hp.length; i++) {
    const v = Math.max(-127, Math.min(127, Math.round(hp[i] * 2))) + 128;
    hex += (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex;
}

function decodeFp(hex) {
  const n = hex.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16) - 128;
  return out;
}

function corr(a, b, W, x0, x1, y0, y1, dx, dy) {
  let n = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
  for (let y = y0; y < y1; y++) {
    const yb = y + dy;
    if (yb < 0 || yb >= a.length / W) continue;
    for (let x = x0; x < x1; x++) {
      const xb = x + dx;
      if (xb < 0 || xb >= W) continue;
      const va = a[y * W + x];
      const vb = b[yb * W + xb];
      if (vb !== vb) continue; // outside the other photo
      n++; sa += va; sb += vb; sab += va * vb; saa += va * va; sbb += vb * vb;
    }
  }
  if (n < 8) return null;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  if (va < 1 || vb < 1) return null; // blank area: nothing to compare
  return cov / Math.sqrt(va * vb);
}

/** Sample grid g (FP_W x FP_H) at a scaled/shifted position; NaN outside. */
function resampleGrid(g, W, H, scale, dx, dy) {
  const out = new Float32Array(W * H);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  for (let j = 0; j < H; j++) {
    const y = (j - cy) * scale + cy + dy;
    const y0 = Math.floor(y);
    const fy = y - y0;
    for (let i = 0; i < W; i++) {
      const x = (i - cx) * scale + cx + dx;
      const x0 = Math.floor(x);
      const fx = x - x0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) { out[j * W + i] = NaN; continue; }
      const a = g[y0 * W + x0], b = g[y0 * W + x0 + 1], c = g[(y0 + 1) * W + x0], d = g[(y0 + 1) * W + x0 + 1];
      out[j * W + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

function regionalScore(a, b, FP_W, FP_H, SHIFT, RG) {
  let total = 0;
  let regions = 0;
  for (let ry = 0; ry < RG; ry++) {
    for (let rx = 0; rx < RG; rx++) {
      const x0 = Math.round((rx * FP_W) / RG);
      const x1 = Math.round(((rx + 1) * FP_W) / RG);
      const y0 = Math.round((ry * FP_H) / RG);
      const y1 = Math.round(((ry + 1) * FP_H) / RG);
      let best = null;
      for (let dy = -SHIFT; dy <= SHIFT; dy++) {
        for (let dx = -SHIFT; dx <= SHIFT; dx++) {
          const c = corr(a, b, FP_W, x0, x1, y0, y1, dx, dy);
          if (c !== null && (best === null || c > best)) best = c;
        }
      }
      if (best !== null) {
        total += best;
        regions++;
      }
    }
  }
  return regions >= 3 ? total / regions : null;
}

/**
 * How alike two pages are: 1 = same page, ~0.4 or less = different page.
 * First lines the two up (the second photo may be a bit closer, further or
 * shifted, e.g. part of the page cut off), then compares 3x3 regions that may
 * each move by SHIFT cells. null = can't tell (blank pages).
 */
const decodedCache = new Map();
function decodeCached(hex) {
  let v = decodedCache.get(hex);
  if (!v) {
    v = decodeFp(hex);
    if (decodedCache.size > 400) decodedCache.clear();
    decodedCache.set(hex, v);
  }
  return v;
}

const simCache = new Map();

export function fingerprintSimilarity(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return null;
  const key = hexA + hexB;
  if (simCache.has(key)) return simCache.get(key);
  const a = decodeCached(hexA);
  const b = decodeCached(hexB);
  const { FP_W, FP_H, SHIFT, REGIONS } = ANALYSIS;
  if (a.length !== FP_W * FP_H) return null;
  // 1. Line the pages up one axis at a time using "how much writing" profiles
  //    (sum of |detail| per row / column). Cheap and enough for closer/further
  //    shots or part of the page cut off.
  const prof = (g, alongRows) => {
    const n = alongRows ? FP_H : FP_W;
    const out = new Float32Array(n);
    for (let j = 0; j < FP_H; j++) for (let i = 0; i < FP_W; i++) out[alongRows ? j : i] += Math.abs(g[j * FP_W + i]);
    return out;
  };
  const fit1d = (pa, pb) => {
    const n = pa.length;
    const c = (n - 1) / 2;
    let bestS = 1;
    let bestD = 0;
    let bestC = -2;
    for (const sc of ANALYSIS.ALIGN_SCALES) {
      for (let d = -ANALYSIS.ALIGN_SHIFT; d <= ANALYSIS.ALIGN_SHIFT; d += 0.5) {
        let m = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
        for (let k = 0; k < n; k++) {
          const x = (k - c) * sc + c + d;
          const x0 = Math.floor(x);
          if (x0 < 0 || x0 + 1 >= n) continue;
          const f = x - x0;
          const vb = pb[x0] * (1 - f) + pb[x0 + 1] * f;
          const va = pa[k];
          m++; sa += va; sb += vb; sab += va * vb; saa += va * va; sbb += vb * vb;
        }
        if (m < n * 0.6) continue;
        const cov = sab - (sa * sb) / m;
        const v1 = saa - (sa * sa) / m;
        const v2 = sbb - (sb * sb) / m;
        if (v1 < 1e-6 || v2 < 1e-6) continue;
        const r = cov / Math.sqrt(v1 * v2);
        if (r > bestC) { bestC = r; bestS = sc; bestD = d; }
      }
    }
    return { s: bestS, d: bestD };
  };
  const fy = fit1d(prof(a, true), prof(b, true));
  const fx = fit1d(prof(a, false), prof(b, false));
  // One scale for both axes (a photo is not stretched): take the average.
  const fine = { s: (fx.s + fy.s) / 2, dx: fx.d, dy: fy.d };
  const aligned =
    fine.s === 1 && fine.dx === 0 && fine.dy === 0 ? b : resampleGrid(b, FP_W, FP_H, fine.s, fine.dx, fine.dy);
  // 3. Region by region (each may still move SHIFT cells). Also try unaligned and keep the better.
  const r1 = regionalScore(a, aligned, FP_W, FP_H, SHIFT, REGIONS);
  const r0 = aligned === b ? r1 : regionalScore(a, b, FP_W, FP_H, SHIFT, REGIONS);
  const result = r1 === null ? r0 : r0 === null ? r1 : Math.max(r0, r1);
  if (simCache.size > 2000) simCache.clear();
  simCache.set(key, result);
  return result;
}

/** Everything at once, on one greyscale analysis image. */
export function analyzePage(gray, w, h) {
  const rect = findPageRect(gray, w, h);
  const skew = estimateSkew(gray, w, h, rect);
  return {
    rect, // null = keep full photo
    skewDeg: (skew * 180) / Math.PI,
    blur: blurScore(gray, w, h, rect), // null = blank page
    fingerprint: pageFingerprint(gray, w, h, rect, skew),
    aspect: h / w,
  };
}
