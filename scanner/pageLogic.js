// screens/pageLogic.js
//
// Pure logic (no React Native imports) so it can be unit-tested with plain Node:
//   - capture-time checks   (is this photo blurry? is it a page we already have?)
//   - duplicate detection    (page fingerprint + OCR text)
//   - blur detection         (sharpness score saved at capture time)
//   - voice command parser   (spoken sentence -> action)

import { fingerprintSimilarity } from './imageAnalysis.js';

// --------------------------------------------------------------------------
// Tuning — log the numbers from real pages (see DEBUG in ScannerScreen) and
// adjust these if your phone/paper behaves differently.
// --------------------------------------------------------------------------
export const CLEANUP = {
  // Page fingerprint similarity (1 = identical). In tests the same page re-shot,
  // tilted up to 5°, scored >= 0.92; different answer sheets on the same printed
  // template scored <= 0.53.
  // (v4: fingerprint now uses the written area, so close/far shots of the same
  // page match. Tests: same page >= 0.67 even with part cut off; different <= 0.49)
  FP_SURE_DUP: 0.8, // this similar = same page, reject straight away
  FP_MAYBE_DUP: 0.6, // in between: use the text to decide

  // Text that is on (almost) every sheet — university name, printed questions —
  // says nothing about WHICH student it is, so it is ignored when comparing.
  TEMPLATE_SHARE: 0.5, // word on >= 50% of this session's pages = printed template
  MIN_DISTINCT_WORDS: 5, // need this many student-specific words to compare text
  TEXT_SAME: 0.5, // share of student-specific words in common = same page (with fp >= MAYBE)
  TEXT_SURE: 0.8, // this much in common = same page even if the photo looks different


  // Blur score is 0 (blurry) .. 1 (sharp), from imageAnalysis.blurScore.
  // In tests: sharp ~0.77, 3 px blur ~0.37, 5 px blur ~0.28.
  BLUR_ABSOLUTE: 0.35, // rejected straight away below this (no OCR needed)
  BLUR_GOOD: 0.5, // between ABSOLUTE and GOOD the page must ALSO read well
  BLUR_RELATIVE_TO_MEDIAN: 0.7, // or clearly worse than this session's pages (needs 2+)

  // Readability (on-device text recognition of the saved page). This is the final
  // check: a page is only kept if the phone can actually read text on it.
  MIN_WORDS: 5, // fewer readable words = blurry / dark / not a page
  GOOD_WORDS: 15, // borderline-sharp pages need at least this many
  MIN_LINE_PX: 22, // median text-line height in the saved image; smaller = too far away
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Lower-case word set (words of 3+ letters/digits). */
export function wordSet(text) {
  if (!text) return new Set();
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  return new Set(words);
}

/** Jaccard similarity of the word sets (0 = nothing shared, 1 = identical). */
export function textSimilarity(a, b) {
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}


function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Is this sharpness score too blurry, given the other pages of the session? */
export function isTooBlurry(score, otherScores = []) {
  if (!Number.isFinite(score)) return false; // blank page / unknown: don't reject
  if (score < CLEANUP.BLUR_ABSOLUTE) return true;
  const known = otherScores.filter(Number.isFinite);
  return known.length >= 2 && score < CLEANUP.BLUR_GOOD && score < median(known) * CLEANUP.BLUR_RELATIVE_TO_MEDIAN;
}

// --------------------------------------------------------------------------
// Readability: can the phone actually read this page?
// --------------------------------------------------------------------------

/**
 * Summarise an ML Kit text-recognition result.
 * Returns { text, words, lines, medianLineHeight }.
 */
export function summarizeOcr(result) {
  const lines = [];
  let words = 0;
  for (const block of result?.blocks || []) {
    for (const line of block.lines || []) {
      lines.push(line);
      for (const el of line.elements || []) {
        if (/[\p{L}\p{N}].*[\p{L}\p{N}]|^\p{N}$/u.test(el.text || '')) words++;
      }
      if (!line.elements || line.elements.length === 0) {
        words += ((line.text || '').match(/[\p{L}\p{N}]{2,}/gu) || []).length;
      }
    }
  }
  const heights = lines.map((l) => l.frame?.height).filter((v) => Number.isFinite(v) && v > 0);
  return {
    text: (result?.text || '').trim(),
    words,
    lines: lines.length,
    medianLineHeight: heights.length ? median(heights) : null,
  };
}

/**
 * Decide whether to keep a photographed page.
 * ocr: from summarizeOcr; blur: imageAnalysis blur score (or null).
 * Returns { ok: true } | { ok: true, warning: 'littleText' } |
 *         { ok: false, reason: 'blurry' | 'tooFar' | 'unreadable' }
 */
export function judgeReadability(ocr, blur) {
  // Blur is checked FIRST and always. Blurred handwriting still makes the reader
  // output many (wrong) words, so a high word count must never excuse a blurry photo.
  if (Number.isFinite(blur) && blur < CLEANUP.BLUR_GOOD) return { ok: false, reason: 'blurry' };
  if (ocr.words >= CLEANUP.MIN_WORDS && ocr.medianLineHeight !== null && ocr.medianLineHeight < CLEANUP.MIN_LINE_PX) {
    return { ok: false, reason: 'tooFar' };
  }
  if (ocr.words >= CLEANUP.MIN_WORDS) return { ok: true };
  return { ok: true, warning: 'littleText' }; // sharp but nearly empty page: keep, but tell the teacher
}

/** What to tell the teacher for each problem. */
export const PROBLEM_TEXT = {
  blurry: 'Blurry — hold the phone still and try again',
  tooFar: 'Text too small — move the phone closer',
  unreadable: 'Text can\'t be read — more light, hold steady',
  duplicate: 'Already scanned',
  littleText: 'Hardly any text found — check this page',
};

// --------------------------------------------------------------------------
// Capture-time check: called right after a photo is analysed, BEFORE saving.
// --------------------------------------------------------------------------

/**
 * analysis: { blur, fingerprint } from imageAnalysis.analyzePage
 * pages:    pages already in this session [{ file, sharpness, fp }]
 * Returns one of:
 *   { ok: true }
 *   { ok: true, maybeDuplicateOf: n }            (save it, re-check after OCR)
 *   { ok: false, reason: 'blurry' }
 *   { ok: false, reason: 'duplicate', duplicateOf: n, sharper: bool }
 * n is the page number the teacher sees (1 = first page).
 */
export function checkNewPage(analysis, pages) {
  if (isTooBlurry(analysis.blur, pages.map((p) => p.sharpness))) {
    return { ok: false, reason: 'blurry' };
  }
  let best = null;
  let bestIndex = -1;
  pages.forEach((p, i) => {
    const sim = fingerprintSimilarity(analysis.fingerprint, p.fp);
    if (sim !== null && (best === null || sim > best)) {
      best = sim;
      bestIndex = i;
    }
  });
  if (best !== null && best >= CLEANUP.FP_SURE_DUP) {
    const old = pages[bestIndex];
    const sharper = Number.isFinite(analysis.blur) && Number.isFinite(old.sharpness)
      ? analysis.blur > old.sharpness * 1.15
      : false;
    return { ok: false, reason: 'duplicate', duplicateOf: bestIndex + 1, sharper, similarity: best };
  }
  if (best !== null && best >= CLEANUP.FP_MAYBE_DUP) {
    return { ok: true, maybeDuplicateOf: bestIndex + 1, similarity: best };
  }
  return { ok: true, similarity: best };
}

// --------------------------------------------------------------------------
// Text comparison (uses what the phone READ on the page)
// --------------------------------------------------------------------------

/** Words of 3+ letters and numbers of 2+ digits, lower-case. */
export function textTokens(text) {
  if (!text) return new Set();
  return new Set(text.toLowerCase().match(/[\p{L}]{3,}|\d{2,}/gu) || []);
}

/** SAP IDs: 5-digit numbers (e.g. 55232). */
export function sapIds(text) {
  return new Set((text || '').match(/(?<!\d)\d{5}(?!\d)/g) || []);
}

/** Words printed on most sheets of this session (only known with 2+ pages). */
export function templateTokens(pages) {
  const withText = pages.filter((p) => p.text);
  if (withText.length < 2) return new Set();
  const count = new Map();
  for (const p of withText) for (const t of textTokens(p.text)) count.set(t, (count.get(t) || 0) + 1);
  const out = new Set();
  // Must be on at least 2 pages AND on TEMPLATE_SHARE of them. (A word on only
  // one of two pages belongs to that student, not to the printed paper.)
  for (const [t, n] of count) if (n >= 2 && n / withText.length >= CLEANUP.TEMPLATE_SHARE) out.add(t);
  return out;
}

/** How much student-specific text two pages share (0..1), or null if too little text. */
export function textOverlap(textA, textB, template) {
  const strip = (t) => new Set([...textTokens(t)].filter((x) => !template.has(x)));
  const A = strip(textA);
  const B = strip(textB);
  if (A.size < CLEANUP.MIN_DISTINCT_WORDS || B.size < CLEANUP.MIN_DISTINCT_WORDS) return null;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

/** Is the new photo clearly sharper than an earlier copy of the page? */
export function isSharperThan(blur, oldPage) {
  return Number.isFinite(blur) && Number.isFinite(oldPage?.sharpness) && blur > oldPage.sharpness * 1.15;
}

/**
 * Earlier pages to compare the feature points with: ALL of them, best candidates
 * first. The photo fingerprint is not reliable across distances (the same page
 * shot close and from further away can look different), so no page may be
 * skipped because its fingerprint looks different. Same SAP ID first, then the
 * most alike fingerprint. Returns page indexes (0-based).
 */
export function candidatePages(candidate, pages) {
  const ids = sapIds(candidate.text);
  return pages
    .map((p, i) => ({
      i,
      sameId: ids.size > 0 && [...sapIds(p.text)].some((id) => ids.has(id)),
      sim: fingerprintSimilarity(candidate.fp, p.fp) ?? -1,
    }))
    .sort((a, b) => (b.sameId - a.sameId) || (b.sim - a.sim))
    .map((x) => x.i);
}

/**
 * Compare a just-captured page with the pages of the session.
 * featureVerdicts: Map(pageIndex -> 'same' | 'maybe' | null) from pageMatch
 * (feature points: the most reliable signal, works on pure handwriting).
 * Also uses the photo fingerprint and the text (words, SAP ID).
 * Returns { sure: n, why } | { possible: n, why } | null      (n = page number, 1-based)
 */
export function findDuplicateOf(candidate, pages, featureVerdicts = new Map()) {
  const template = templateTokens(pages);
  const ids = sapIds(candidate.text);
  for (const t of template) ids.delete(t);
  let possible = null;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const feat = featureVerdicts.get(i) ?? null;
    const fp = fingerprintSimilarity(candidate.fp, p.fp);
    const txt = pages.length >= 2 ? textOverlap(candidate.text, p.text, template) : null;
    const sameId = [...ids].some((id) => sapIds(p.text).has(id));
    const fpSure = fp !== null && fp >= CLEANUP.FP_SURE_DUP;
    const fpMaybe = fp !== null && fp >= CLEANUP.FP_MAYBE_DUP;
    const textAgrees = (txt !== null && txt >= CLEANUP.TEXT_SAME) || sameId;
    const why = { features: feat, similarity: fp, textOverlap: txt, sameSapId: sameId };
    if (feat === 'same' || fpSure) return { sure: i + 1, why };
    if ((feat === 'maybe' || fpMaybe) && textAgrees) return { sure: i + 1, why };
    if (txt !== null && txt >= CLEANUP.TEXT_SURE) return { sure: i + 1, why };
    if (!possible && (feat === 'maybe' || fpMaybe || textAgrees)) possible = { possible: i + 1, why };
  }
  return possible;
}

// --------------------------------------------------------------------------
// Duplicates / blur over the whole session (used after OCR and on the review
// screen as a safety net).
// --------------------------------------------------------------------------

/** Are these two pages the same page scanned twice? (session safety net) */
export function isDuplicatePair(p, q, template = new Set()) {
  const fpSim = fingerprintSimilarity(p.fp, q.fp);
  if (fpSim !== null && fpSim >= CLEANUP.FP_SURE_DUP) return true;
  const txt = textOverlap(p.text, q.text, template);
  if (txt !== null && txt >= CLEANUP.TEXT_SURE && template.size > 0) return true;
  return fpSim !== null && fpSim >= CLEANUP.FP_MAYBE_DUP && txt !== null && txt >= CLEANUP.TEXT_SAME;
}

/**
 * Returns the files that should be deleted as duplicates.
 * From each group of duplicates the SHARPEST copy is kept.
 * pages: [{ file, fp, text, sharpness }] in capture order.
 */
export function findDuplicates(pages) {
  const template = templateTokens(pages);
  const kept = [];
  const remove = new Set();
  for (const page of pages) {
    const twin = kept.find((k) => isDuplicatePair(k, page, template));
    if (!twin) {
      kept.push(page);
      continue;
    }
    if ((page.sharpness ?? 0) > (twin.sharpness ?? 0)) {
      remove.add(twin.file);
      kept[kept.indexOf(twin)] = page;
    } else {
      remove.add(page.file);
    }
  }
  return [...remove];
}

/** Returns the files that should be deleted as blurry. */
export function findBlurry(pages) {
  const scores = pages.map((p) => p.sharpness);
  return pages
    .filter((p, i) => isTooBlurry(p.sharpness, scores.filter((_, j) => j !== i)))
    .map((p) => p.file);
}

// --------------------------------------------------------------------------
// Voice commands
// --------------------------------------------------------------------------

const NUMBER_WORDS = {
  one: 1, first: 1, two: 2, second: 2, to: 2, too: 2, three: 3, third: 3,
  four: 4, for: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6,
  seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const DELETE_WORDS = /\b(delete|remove|clear|discard|erase|get rid of|throw away)\b/;

/**
 * Turn a spoken sentence into an action, or null if it is not a command.
 *   { action: 'deleteDuplicates' }   "delete duplicates", "remove duplicate pages"
 *   { action: 'deleteBlurry' }       "delete blurry pages", "remove blurred"
 *   { action: 'cleanUp' }            "clean up", "delete blurry and duplicates"
 *   { action: 'deleteLast' }         "delete last page", "delete that"
 *   { action: 'deletePage', page }   "delete page 3", "remove page three"
 *   { action: 'undo' }               "undo", "bring it back"
 *   { action: 'capture' }            "capture", "take it", "scan now"
 *   { action: 'upload' }             "upload", "send pages", "finish and upload"
 *   { action: 'endSession' }         "end session", "stop scanning"
 *   { action: 'stopListening' }      "stop listening"
 */
export function parseCommand(transcript) {
  if (!transcript) return null;
  const t = ` ${transcript.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;

  if (/\bstop listening\b|\bmic off\b|\bmute\b/.test(t)) return { action: 'stopListening' };
  if (/\bundo\b|\bbring (it|them) back\b|\brestore\b/.test(t)) return { action: 'undo' };

  const dup = /\bduplicat\w*|\bcopies\b|\brepeated\b|\bdouble\w*\b/.test(t);
  const blur = /\bblur\w*|\bblurr\w*|\bfuzzy\b|\bunclear\b|\bout of focus\b/.test(t);
  const del = DELETE_WORDS.test(t);

  if (/\bclean ?up\b|\bclean (the )?pages\b/.test(t) || (del && dup && blur)) {
    return { action: 'cleanUp' };
  }
  if (dup && (del || /\bduplicates?\b/.test(t))) return { action: 'deleteDuplicates' };
  if (blur && (del || /\bpages?\b/.test(t))) return { action: 'deleteBlurry' };

  if (del) {
    const pageNum = t.match(/\bpage (?:number )?(\d+|[a-z]+)\b/);
    if (pageNum) {
      const n = /^\d+$/.test(pageNum[1]) ? parseInt(pageNum[1], 10) : NUMBER_WORDS[pageNum[1]];
      if (n) return { action: 'deletePage', page: n };
      if (pageNum[1] === 'last' || pageNum[1] === 'previous') return { action: 'deleteLast' };
    }
    if (/\blast\b|\bprevious\b|\bthat\b|\bthis\b/.test(t)) return { action: 'deleteLast' };
  }

  if (/\bcapture\b|\btake (it|photo|picture)\b|\bscan (it|now|this)\b|\bshoot\b/.test(t)) {
    return { action: 'capture' };
  }
  if (/\bupload\b|\bsend (the )?pages\b|\bsubmit\b/.test(t)) return { action: 'upload' };
  if (/\bend (the )?session\b|\bstop scanning\b|\bfinish(ed)? scanning\b/.test(t)) {
    return { action: 'endSession' };
  }
  return null;
}