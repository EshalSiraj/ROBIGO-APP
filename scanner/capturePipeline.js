// screens/capturePipeline.js
//
// What happens to a photo right after the shutter:
//
//   1. analyzePhoto()  one small (640 px) copy -> real pixels -> page box, tilt,
//                      blur score and fingerprint.          ~0.2-0.4 s on a phone
//   2. pageLogic.checkNewPage()  clearly blurry? same page as before? (instant)
//   3. savePagePhoto() crop to the page and save at full resolution.
//   4. readPage()      on-device text recognition of the saved page. If the phone
//                      can't read it, the page is NOT kept (pageLogic.judgeReadability).
//
// The old code read pixels with ImageRef.getPixels(), which does not exist in
// expo-image-manipulator, so every check threw and was silently skipped.

import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { summarizeOcr } from './pageLogic.js';
import { ANALYSIS, analyzePage, base64ToBytes, rgbaToGray } from './imageAnalysis.js';

// Saved pages are at most this wide (the photo is 1944x2592). Full resolution of
// the page area is kept so small handwriting stays readable.
export const MAX_SAVE_WIDTH = 1944;
const SAVE_QUALITY = 0.88;

const toUri = (path) => (path.startsWith('file://') ? path : `file://${path}`);

function release(ref) {
  // Free the native image memory right away instead of waiting for GC.
  try {
    ref?.release?.();
  } catch {}
}

/**
 * Analyse a captured photo. Returns
 *   { rect, skewDeg, blur, fingerprint, aspect, ms }
 * rect = page box as fractions (null = keep whole photo), blur = 0..1 or null.
 */
export async function analyzePhoto(photoPath) {
  const started = Date.now();
  const uri = toUri(photoPath);
  const small = await ImageManipulator.manipulate(uri).resize({ width: ANALYSIS.WIDTH }).renderAsync();
  let saved;
  try {
    saved = await small.saveAsync({ format: SaveFormat.JPEG, compress: 0.92, base64: true });
  } finally {
    release(small);
  }
  FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(() => {});
  const img = jpeg.decode(base64ToBytes(saved.base64), { useTArray: true, formatAsRGBA: true });
  const gray = rgbaToGray(img.data, img.width, img.height);
  const result = analyzePage(gray, img.width, img.height);
  // gray is kept (not saved anywhere) so feature points can be found for the
  // duplicate check while the page is being saved and read.
  return { ...result, gray, grayW: img.width, grayH: img.height, ms: Date.now() - started };
}

/**
 * Crop to the page and save to destPath (a file:// path), keeping full
 * resolution. Returns { width, height } of the saved page.
 * The original photo is NOT deleted here (call discardPhoto when done).
 */
export async function savePagePhoto(photoPath, analysis, destPath) {
  const uri = toUri(photoPath);
  // Work in a known width so the crop box (fractions) maps to exact pixels.
  const W = analysis.photoWidth ? Math.min(analysis.photoWidth, MAX_SAVE_WIDTH) : MAX_SAVE_WIDTH;
  const Hh = Math.round(W * analysis.aspect);
  let ctx = ImageManipulator.manipulate(uri).resize({ width: W });
  let outW = W;
  let outH = Hh;
  const r = analysis.rect;
  if (r) {
    const originX = Math.max(0, Math.floor(r.x0 * W));
    const originY = Math.max(0, Math.floor(r.y0 * Hh));
    const width = Math.min(W - originX, Math.ceil((r.x1 - r.x0) * W));
    const height = Math.min(Hh - originY, Math.ceil((r.y1 - r.y0) * Hh));
    if (width > 64 && height > 64) {
      ctx = ctx.crop({ originX, originY, width, height });
      outW = width;
      outH = height;
    }
  }
  const image = await ctx.renderAsync();
  let out;
  try {
    out = await image.saveAsync({ format: SaveFormat.JPEG, compress: SAVE_QUALITY });
  } finally {
    release(image);
  }
  await FileSystem.moveAsync({ from: toUri(out.uri), to: destPath });
  return { width: outW, height: outH };
}

/** On-device text recognition of a saved page. Returns summarizeOcr(...). */
export async function readPage(fileUri) {
  const result = await TextRecognition.recognize(fileUri);
  return summarizeOcr(result);
}

/** Throw the photo away (rejected as blurry or duplicate). */
export function discardPhoto(photoPath) {
  if (!photoPath) return Promise.resolve();
  return FileSystem.deleteAsync(toUri(photoPath), { idempotent: true }).catch(() => {});
}
