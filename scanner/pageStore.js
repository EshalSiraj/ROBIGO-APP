// screens/pageStore.js
//
// Keeps the scanned pages of the current session on the phone:
//   scans/page-001.jpg ...     the images
//   scans/pages.json           one entry per page: sharpness, fingerprint, OCR text
//   scans/trash/               deleted pages (so "undo" can bring them back)
//
// Every change goes through one queue, so the camera, the OCR worker and voice
// commands can never overwrite each other's changes to pages.json.
// The page list is also kept in memory, so the disk is only written, not
// re-read, on every change (faster with many pages).

import * as FileSystem from 'expo-file-system/legacy';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { findBlurry, findDuplicates, isDuplicatePair, templateTokens } from './pageLogic.js';
import { decodeFeatures } from './pageMatch.js';

export const SCANS_DIR = FileSystem.documentDirectory + 'scans/';
const TRASH_DIR = SCANS_DIR + 'trash/';
const MANIFEST = SCANS_DIR + 'pages.json';

let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

const listeners = new Set();
/** Subscribe to page-list changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(manifest) {
  // New array each time so React sees the change.
  const snapshot = { ...manifest, pages: [...manifest.pages] };
  for (const fn of listeners) fn(snapshot);
}

function emptyManifest() {
  return { pages: [], lastDeleted: [], nextSeq: 1 };
}

let cache = null;

// ------------------------------------------------- feature points per page
// Saved as scans/page-001.jpg.kp (about 25 KB) and kept in memory, so the
// duplicate check never has to look at the images again.
const featureCache = new Map();

export async function saveFeatures(file, encoded) {
  featureCache.set(file, encoded);
  await FileSystem.writeAsStringAsync(SCANS_DIR + file + '.kp', encoded).catch((e) =>
    console.warn('Could not save features:', e?.message)
  );
}

/** Feature points of a page (decoded), or null if none were saved. */
export async function loadFeatures(file) {
  let enc = featureCache.get(file);
  if (enc === undefined) {
    try {
      enc = await FileSystem.readAsStringAsync(SCANS_DIR + file + '.kp');
    } catch {
      enc = null;
    }
    featureCache.set(file, enc);
  }
  return enc ? decodeFeatures(enc) : null;
}

async function read() {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(MANIFEST);
    cache = info.exists
      ? { ...emptyManifest(), ...JSON.parse(await FileSystem.readAsStringAsync(MANIFEST)) }
      : emptyManifest();
  } catch (err) {
    console.warn('pages.json unreadable, starting fresh:', err?.message);
    cache = emptyManifest();
  }
  return cache;
}

async function write(manifest) {
  cache = manifest;
  await FileSystem.makeDirectoryAsync(SCANS_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(MANIFEST, JSON.stringify(manifest));
  notify(manifest);
  return manifest;
}

/** Current page list (oldest first). */
export function loadPages() {
  return serial(async () => {
    const m = await read();
    return { ...m, pages: [...m.pages] };
  });
}

/** Wipe everything and start a new session. */
export function resetSession() {
  return serial(async () => {
    await FileSystem.deleteAsync(SCANS_DIR, { idempotent: true });
    await FileSystem.makeDirectoryAsync(TRASH_DIR, { intermediates: true });
    cache = null;
    featureCache.clear();
    return write(emptyManifest());
  });
}

/** Reserve the next file name, e.g. page-007.jpg (never reused, even after deletes). */
export function reserveFileName() {
  return serial(async () => {
    const m = await read();
    const seq = m.nextSeq;
    await write({ ...m, nextSeq: seq + 1 });
    return `page-${String(seq).padStart(3, '0')}.jpg`;
  });
}

/**
 * Register a page straight after it passed the checks. The image is still being
 * saved in the background (saving: true) — call finishSave() when it's on disk.
 */
export function addPage(entry) {
  return serial(async () => {
    const m = await read();
    m.pages = [...m.pages, { text: null, ocrStatus: 'pending', saving: true, capturedAt: Date.now(), ...entry }];
    return write(m);
  });
}

/** Change fields of one page. Returns false if the page no longer exists. */
export function updatePage(file, patch) {
  return serial(async () => {
    const m = await read();
    const i = m.pages.findIndex((x) => x.file === file);
    if (i < 0) return false; // page was deleted meanwhile
    m.pages = m.pages.map((p, j) => (j === i ? { ...p, ...patch } : p));
    await write(m);
    return true;
  });
}

// ------------------------------------------------------- background saving

let saveQueue = Promise.resolve();

/**
 * Run the slow image save in the background, one at a time.
 * saveFn() must write the image to SCANS_DIR + file.
 */
export function saveInBackground(file, saveFn, onDone) {
  saveQueue = saveQueue.then(async () => {
    try {
      await saveFn();
      const stillThere = await updatePage(file, { saving: false });
      if (!stillThere) {
        // Deleted while saving (e.g. "delete last page"): don't leave the file behind.
        await FileSystem.deleteAsync(SCANS_DIR + file, { idempotent: true });
        return;
      }
      onDone?.(null);
    } catch (err) {
      console.warn('Saving page failed:', file, err?.message);
      await deletePages([file], { keepUndo: true });
      onDone?.(err);
    }
  });
  return saveQueue;
}

export function waitForSaves() {
  return saveQueue;
}

// ------------------------------------------------------------------ delete

/**
 * Move pages to the trash. Returns how many were deleted.
 * Only the most recent delete can be undone (keepUndo: keep the previous one).
 */
export function deletePages(files, { keepUndo = false } = {}) {
  return serial(async () => {
    const m = await read();
    const wanted = new Set(files);
    const gone = m.pages.filter((p) => wanted.has(p.file));
    if (gone.length === 0) return 0;

    if (!keepUndo) {
      for (const p of m.lastDeleted) {
        FileSystem.deleteAsync(TRASH_DIR + p.file, { idempotent: true }).catch(() => {});
      }
    }
    await FileSystem.makeDirectoryAsync(TRASH_DIR, { intermediates: true }).catch(() => {});
    for (const p of gone) {
      await FileSystem.moveAsync({ from: SCANS_DIR + p.file, to: TRASH_DIR + p.file }).catch(() => {});
    }
    m.pages = m.pages.filter((p) => !wanted.has(p.file));
    m.lastDeleted = keepUndo ? [...m.lastDeleted, ...gone] : gone;
    await write(m);
    return gone.length;
  });
}

/** Bring back the last deleted pages. Returns how many were restored. */
export function undoDelete() {
  return serial(async () => {
    const m = await read();
    const back = m.lastDeleted || [];
    if (back.length === 0) return 0;
    for (const p of back) {
      await FileSystem.moveAsync({ from: TRASH_DIR + p.file, to: SCANS_DIR + p.file }).catch(() => {});
    }
    m.pages = [...m.pages, ...back.map((p) => ({ ...p, saving: false }))].sort((a, b) =>
      a.file.localeCompare(b.file)
    );
    m.lastDeleted = [];
    await write(m);
    return back.length;
  });
}

export async function deleteDuplicates() {
  const { pages } = await loadPages();
  return deletePages(findDuplicates(pages));
}

export async function deleteBlurry() {
  const { pages } = await loadPages();
  return deletePages(findBlurry(pages));
}

/** Blurry first, then duplicates among what is left. */
export async function cleanUp() {
  const { pages } = await loadPages();
  const blurry = new Set(findBlurry(pages));
  const dups = findDuplicates(pages.filter((p) => !blurry.has(p.file)));
  return deletePages([...blurry, ...dups]);
}

export async function deleteLastPage() {
  const { pages } = await loadPages();
  return pages.length ? deletePages([pages[pages.length - 1].file]) : 0;
}

/** pageNumber as the teacher sees it: 1 = first page in the list. */
export async function deletePageNumber(pageNumber) {
  const { pages } = await loadPages();
  const p = pages[pageNumber - 1];
  return p ? deletePages([p.file]) : 0;
}

// --------------------------------------------------------------------- OCR

let ocrQueue = Promise.resolve();

/**
 * Read the text on a page with on-device ML Kit (works offline), one page at a
 * time in the background. When the text shows the page is a duplicate of an
 * earlier one, the less sharp copy is removed automatically and
 * onAutoRemoved({ removedNumber, keptNumber }) is called (teacher can say "undo").
 */
export function runOcr(file, onAutoRemoved) {
  ocrQueue = ocrQueue.then(async () => {
    try {
      const result = await TextRecognition.recognize(SCANS_DIR + file);
      const text = (result?.text || '').trim();
      const lines = (result?.blocks || []).reduce((n, b) => n + (b.lines?.length || 0), 0);
      const exists = await updatePage(file, { text, lineCount: lines, ocrStatus: 'done' });
      if (exists) await removeDuplicateOf(file, onAutoRemoved);
    } catch (err) {
      console.warn('OCR failed for', file, err?.message);
      await updatePage(file, { ocrStatus: 'failed' });
    }
  });
  return ocrQueue;
}

/**
 * After a page is kept: if its text shows it is the same as an earlier page,
 * remove the less sharp copy and call onAutoRemoved({ removedNumber, keptNumber }).
 */
export async function removeDuplicateOf(file, onAutoRemoved) {
  const { pages } = await loadPages();
  const i = pages.findIndex((p) => p.file === file);
  if (i < 0) return;
  const page = pages[i];
  const template = templateTokens(pages);
  const j = pages.findIndex((q, k) => k !== i && !q.saving && q.ocrStatus === 'done' && isDuplicatePair(page, q, template));
  if (j < 0) return;
  const other = pages[j];
  const loser = (page.sharpness ?? 0) > (other.sharpness ?? 0) ? other : page;
  const keptNumber = (loser === page ? j : i) + 1;
  const removedNumber = (loser === page ? i : j) + 1;
  const n = await deletePages([loser.file]);
  if (n) onAutoRemoved?.({ removedNumber, keptNumber });
}

/**
 * A page that is already kept: wait for its background save and text reading
 * (readingWork resolves to the OCR summary, or null), then:
 *   - unreadable (judge(ocr) not ok): removed, onRemoved(reason) is called;
 *   - readable: the text is stored on the page and a duplicate of an earlier page
 *     is removed (onAutoRemoved, as in runOcr).
 * Queued with the other OCR work, so uploads wait for it.
 */
export function finishReading(file, readingWork, judge, onRemoved, onAutoRemoved) {
  ocrQueue = ocrQueue.then(async () => {
    try {
      const ocr = await readingWork;
      const verdict = ocr ? judge(ocr) : { ok: true };
      if (!verdict.ok) {
        const n = await deletePages([file]);
        if (n) onRemoved?.(verdict.reason);
        return;
      }
      const exists = await updatePage(file, {
        text: ocr?.text ?? null,
        lineCount: ocr?.lines ?? 0,
        words: ocr?.words ?? 0,
        ocrStatus: ocr ? 'done' : 'failed',
        warning: verdict.warning ?? null,
      });
      if (exists) await removeDuplicateOf(file, onAutoRemoved);
    } catch (err) {
      console.warn('Reading failed for', file, err?.message);
      await updatePage(file, { ocrStatus: 'failed' });
    }
  });
  return ocrQueue;
}

/** Resolves when every queued OCR job has finished. */
export function waitForOcr() {
  return ocrQueue;
}

// ------------------------------------------------------------------ upload

async function postWithRetry(url, body, tries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (res.ok) return true;
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) break; // our request is wrong: retrying won't help
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  throw lastErr;
}

/**
 * Upload the pages not uploaded yet, numbered 1..N in their current order.
 * Deleted pages are never sent. Two uploads run at once. onProgress(done, total).
 */
export async function uploadAll(backendUrl, sessionId, onProgress) {
  await waitForSaves();
  await waitForOcr();
  const { pages } = await loadPages();
  const todo = pages.map((p, i) => ({ p, number: i + 1 })).filter(({ p }) => !p.uploaded);
  let ok = 0;
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const { p, number } = todo[next++];
      try {
        const image_base64 = await FileSystem.readAsStringAsync(SCANS_DIR + p.file, { encoding: 'base64' });
        await postWithRetry(
          `${backendUrl}/scans/${sessionId}`,
          JSON.stringify({
            page_number: number,
            image_base64,
            ocr_text: p.text || '',
            sharpness: p.sharpness ?? null,
            // Few lines read on a sharp page usually means handwriting the phone
            // could not read: the backend should run its own handwriting OCR.
            needs_server_ocr: p.ocrStatus !== 'done' || (p.lineCount ?? 0) < 3,
          })
        );
        ok++;
        await updatePage(p.file, { uploaded: true });
      } catch (err) {
        console.warn('Upload failed', p.file, err?.message);
      }
      onProgress?.(++done, todo.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return { uploaded: ok, total: todo.length, alreadyUploaded: pages.length - todo.length };
}

// --------------------------------------------------------- voice commands

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Run a delete / undo command from parseCommand(). Returns a short message to
 * show the user, or null if the command is not a delete/undo command.
 */
export async function runPageCommand(command) {
  switch (command.action) {
    case 'deleteDuplicates': {
      const n = await deleteDuplicates();
      return n ? `Deleted ${plural(n, 'duplicate page')}` : 'No duplicate pages found';
    }
    case 'deleteBlurry': {
      const n = await deleteBlurry();
      return n ? `Deleted ${plural(n, 'blurry page')}` : 'No blurry pages found';
    }
    case 'cleanUp': {
      const n = await cleanUp();
      return n ? `Cleaned up: deleted ${plural(n, 'page')}` : 'Nothing to clean up';
    }
    case 'deleteLast': {
      const n = await deleteLastPage();
      return n ? 'Deleted the last page' : 'No pages to delete';
    }
    case 'deletePage': {
      const n = await deletePageNumber(command.page);
      return n ? `Deleted page ${command.page}` : `There is no page ${command.page}`;
    }
    case 'undo': {
      const n = await undoDelete();
      return n ? `Restored ${plural(n, 'page')}` : 'Nothing to undo';
    }
    default:
      return null;
  }
}