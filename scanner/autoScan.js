// screens/autoScan.js
//
// Auto-capture logic for the EDVYA scanner. Everything in here is a plain
// function marked 'worklet', so it can run on the camera thread (VisionCamera's
// frame-processor runtime) WITHOUT touching the JS thread on every frame.
//
// State machine:
//   READY ──(still + sharp + paper-bright for a moment)──▶ CAPTURING
//     ▲                                                        │
//     │                                                        ▼
//     └───(scene changed a lot: hand / page swap / paper gone)── WAIT_NEW_PAGE
//
// The live check here only decides WHEN to take the photo. The photo itself is
// then checked properly (blur, duplicate, page crop) in capturePipeline.js.

export const PHASE = {
  IDLE: 0,
  READY: 1,
  CAPTURING: 2,
  WAIT_NEW_PAGE: 3,
};

// What the teacher should do right now (shown as a hint on screen).
export const HINT = {
  NONE: 0,
  NO_PAGE: 1, // nothing bright in the middle: point at a page
  TOO_DARK: 2, // page found but dim: more light
  MOVING: 3, // hold still
  FOCUSING: 4, // still, but not sharp yet
  STEADY: 5, // about to capture
  NEXT_PAGE: 6, // captured: show the next page
  MOVE_CLOSER: 7, // page is small in the picture: text would be too small to read
};

export const CONFIG = {
  GRID_W: 16,
  GRID_H: 20,
  FRAME_SIZE: { width: 240, height: 320 },
  SAMPLE_INTERVAL_MS: 100,
  // Steadiness is measured as how many preview pixels the picture moved between
  // two samples. Same meaning near or far, so the teacher can hold the phone close.
  MAX_SHIFT_PX: 1, // still = moved at most 1 preview pixel
  MAX_SEARCH_SHIFT: 8,
  BIG_CHANGE: 10, // brightness change of the whole picture = hand / page moving in
  STILL_MOTION: 3.5, // kept for the HUD
  SHARP_SETTLE: 0.25, // autofocus settled (was 0.12, too strict close up)
  STILL_SAMPLES: 3, // 3 calm samples (~0.3 s) before shooting
  REARM_DIST: 12,
  MIN_PAPER_LUMA: 90,
  DIM_PAPER_LUMA: 120, // below this we suggest more light (still captures)

  // Focus: ratio of 1-px to 2-px edge energy. ~0.5 = sharp, ~0.25 = blurry,
  // whatever is written on the page. Lenient: the photo is checked properly later.
  MIN_FOCUS: 0.3,
  MIN_EDGE_SAMPLES: 40, // fewer edges = nothing to read in view
  // Page must cover this share of the picture, else text is too small.
  // v9: 0.4 needed the page to fill ~63% of the view width (standing very close).
  // 0.15 = about 40% of the width. Text that is still too small is caught after
  // reading (pageLogic MIN_LINE_PX) and the teacher is told to move closer.
  MIN_COVERAGE: 0.15,
  CAPTURE_SHARPNESS: 1.0, // kept for the HUD only

  COOLDOWN_MS: 1500,
  HUD_EVERY: 2,
};

export function freshMemory() {
  return {
    prevSig: null,
    prevSharp: 0,
    capturedSig: null,
    prevRows: null,
    prevCols: null,
    stillCount: 0,
    cooldownUntil: 0,
    samples: 0,
  };
}

function meanAbsDiff(a, b) {
  'worklet';
  let sum = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d < 0 ? -d : d;
  }
  return sum / n;
}

/** Best shift (in samples) between two brightness profiles. */
function bestShift(a, b, maxS) {
  'worklet';
  let best = 0;
  let bestErr = 1e9;
  const len = a.length;
  for (let s = -maxS; s <= maxS; s++) {
    let err = 0;
    let n = 0;
    for (let i = maxS; i < len - maxS; i++) {
      const d = a[i] - b[i + s];
      err += d < 0 ? -d : d;
      n++;
    }
    err = n ? err / n : 1e9;
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return best;
}

/**
 * Reduce the Y (brightness) plane of a YUV frame to:
 *  - sig:        GRID_W*GRID_H average brightness cells (a tiny "fingerprint")
 *  - sharp:      average |gradient| over many sample points
 *  - centerMean: average brightness of the middle of the frame
 */
export function computeFeatures(y, stride, width, height) {
  'worklet';
  const GW = CONFIG.GRID_W;
  const GH = CONFIG.GRID_H;
  const STEP = Math.max(1, Math.round(Math.min(width, height) / CONFIG.FRAME_SIZE.width));
  const cellW = Math.floor(width / GW);
  const cellH = Math.floor(height / GH);
  const sig = new Array(GW * GH);

  const r0 = Math.floor(GH * 0.25);
  const r1 = Math.ceil(GH * 0.75);
  const c0 = Math.floor(GW * 0.2);
  const c1 = Math.ceil(GW * 0.8);

  let gradSum = 0;
  let gradCount = 0;
  let centerSum = 0;
  let centerCount = 0;
  let e1 = 0; // energy of 1-px steps at edges
  let e2 = 0; // energy of 2-px steps at edges
  let edgeSamples = 0;

  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x0 = gx * cellW;
      const y0 = gy * cellH;
      const xEnd = x0 + cellW - 2;
      const yEnd = y0 + cellH - 2;
      let sum = 0;
      let n = 0;
      for (let py = y0; py < yEnd; py += STEP) {
        const row = py * stride;
        const rowBelow = row + 2 * stride;
        for (let px = x0; px < xEnd; px += STEP) {
          const p = y[row + px];
          sum += p;
          n++;
          const dx = p - y[row + px + 2];
          const dy = p - y[rowBelow + px];
          gradSum += (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
          gradCount += 2;
          if (dx > 12 || dx < -12) {
            const d1 = p - y[row + px + 1];
            e1 += d1 * d1;
            e2 += dx * dx;
            edgeSamples++;
          }
        }
      }
      const mean = n > 0 ? sum / n : 0;
      sig[gy * GW + gx] = mean;
      if (gy >= r0 && gy < r1 && gx >= c0 && gx < c1) {
        centerSum += mean;
        centerCount++;
      }
    }
  }

  // Row and column brightness profiles, for measuring how far the picture moved.
  const PS = STEP * 2;
  const rows = [];
  for (let py = 0; py < height; py += PS) {
    let s2 = 0;
    let n2 = 0;
    const row = py * stride;
    for (let px = 0; px < width; px += PS * 2) {
      s2 += y[row + px];
      n2++;
    }
    rows.push(n2 ? s2 / n2 : 0);
  }
  const cols = [];
  for (let px = 0; px < width; px += PS) {
    let s2 = 0;
    let n2 = 0;
    for (let py = 0; py < height; py += PS * 2) {
      s2 += y[py * stride + px];
      n2++;
    }
    cols.push(n2 ? s2 / n2 : 0);
  }

  let paperCells = 0;
  for (let i = 0; i < sig.length; i++) if (sig[i] >= CONFIG.MIN_PAPER_LUMA) paperCells++;

  return {
    sig,
    sharp: gradCount > 0 ? gradSum / gradCount : 0,
    focus: e2 > 0 ? e1 / e2 : 0,
    edgeSamples,
    coverage: paperCells / sig.length,
    centerMean: centerCount > 0 ? centerSum / centerCount : 0,
    rows,
    cols,
    profileStep: PS,
  };
}

export function stepAnalyzer(phase, mem, feat, now) {
  'worklet';
  const sig = feat.sig;

  const bigChange = mem.prevSig ? meanAbsDiff(sig, mem.prevSig) : 255;
  const dist = mem.capturedSig ? meanAbsDiff(sig, mem.capturedSig) : 0;
  // How many preview pixels the picture moved since the last sample.
  let shift = 99;
  if (mem.prevRows && mem.prevRows.length === feat.rows.length && mem.prevCols.length === feat.cols.length) {
    const sy = bestShift(feat.rows, mem.prevRows, CONFIG.MAX_SEARCH_SHIFT);
    const sx = bestShift(feat.cols, mem.prevCols, CONFIG.MAX_SEARCH_SHIFT);
    const ay = sy < 0 ? -sy : sy;
    const ax = sx < 0 ? -sx : sx;
    shift = (ax > ay ? ax : ay) * feat.profileStep;
  }
  const sharpChange =
    mem.prevSharp > 0 ? Math.abs(feat.sharp - mem.prevSharp) / (mem.prevSharp + 0.1) : 1;

  const settled = shift <= CONFIG.MAX_SHIFT_PX * feat.profileStep && bigChange < CONFIG.BIG_CHANGE && sharpChange < CONFIG.SHARP_SETTLE;
  const stillCount = settled ? mem.stillCount + 1 : 0;
  const hasPaper = feat.centerMean >= CONFIG.MIN_PAPER_LUMA;
  const bigEnough = feat.coverage >= CONFIG.MIN_COVERAGE;
  const inFocus = feat.edgeSamples >= CONFIG.MIN_EDGE_SAMPLES && feat.focus >= CONFIG.MIN_FOCUS;

  let nextPhase = phase;
  let trigger = false;
  let capturedSig = mem.capturedSig;
  let rearmed = false;

  if (phase === PHASE.WAIT_NEW_PAGE) {
    // A new page (or the page was taken away). If the SAME page comes back,
    // the duplicate check on the photo will catch it.
    if (dist >= CONFIG.REARM_DIST || !hasPaper) {
      nextPhase = PHASE.READY;
      rearmed = true;
    }
  } else if (phase === PHASE.READY) {
    if (stillCount >= CONFIG.STILL_SAMPLES && hasPaper && bigEnough && inFocus && now >= mem.cooldownUntil) {
      nextPhase = PHASE.CAPTURING;
      trigger = true;
      capturedSig = sig;
    }
  }

  // Hint for the teacher (most important problem first)
  let hint = HINT.NONE;
  if (nextPhase === PHASE.WAIT_NEW_PAGE) hint = HINT.NEXT_PAGE;
  else if (!hasPaper) hint = HINT.NO_PAGE;
  else if (!bigEnough) hint = HINT.MOVE_CLOSER;
  else if (!settled) hint = HINT.MOVING;
  else if (!inFocus) hint = HINT.FOCUSING;
  else if (feat.centerMean < CONFIG.DIM_PAPER_LUMA) hint = HINT.TOO_DARK;
  else hint = HINT.STEADY;

  const samples = mem.samples + 1;
  const nextMem = {
    prevSig: sig,
    prevSharp: feat.sharp,
    prevRows: feat.rows,
    prevCols: feat.cols,
    capturedSig,
    stillCount: trigger || rearmed ? 0 : stillCount,
    cooldownUntil: mem.cooldownUntil,
    samples,
  };

  return {
    phase: nextPhase,
    mem: nextMem,
    trigger,
    debug: {
      phase: nextPhase,
      hint,
      motion: bigChange,
      shift,
      focus: feat.focus,
      coverage: feat.coverage,
      dist,
      sharp: feat.sharp,
      luma: feat.centerMean,
      still: nextMem.stillCount,
      sendHud: samples % CONFIG.HUD_EVERY === 0 || trigger || rearmed,
    },
  };
}