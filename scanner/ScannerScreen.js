// screens/ScannerScreen.js
//
// Live camera scanner.
//   1. The frame analyser (autoScan.js) fires the shutter when the page is steady,
//      in focus and big enough in the picture (it says "move closer" / "hold still").
//   2. Every photo is checked AT ONCE (capturePipeline.js + pageLogic.js):
//        clearly blurry  -> thrown away, "hold the phone still", retries
//        same page again -> thrown away (or replaces the old copy if sharper)
//        then the phone tries to READ the page: unreadable or text too small
//        -> not kept, the teacher is told what to fix.
//   3. "Check each page" ON: a preview with Keep / Retake is shown for every page.
//      OFF: good pages are kept automatically, with a Retake button for a few seconds.
// Voice commands work here and on the review screen. Pages are uploaded at the end.

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  usePhotoOutput,
} from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import GalleryScreen from './GalleryScreen';
import { CONFIG, HINT, PHASE, computeFeatures, freshMemory, stepAnalyzer } from './autoScan.js';
import { analyzePhoto, discardPhoto, readPage, savePagePhoto } from './capturePipeline.js';
import { CLEANUP, PROBLEM_TEXT, candidatePages, checkNewPage, findDuplicateOf, isSharperThan, judgeReadability } from './pageLogic.js';
import { cropGray, encodeFeatures, extractFeatures, matchFeatures, pageVerdict } from './pageMatch.js';
import {
  SCANS_DIR,
  addPage,
  deletePages,
  finishReading,
  loadFeatures,
  loadPages,
  removeDuplicateOf,
  reserveFileName,
  resetSession,
  runPageCommand,
  saveFeatures,
  subscribe,
  updatePage,
  uploadAll,
} from './pageStore.js';
import useVoiceCommands from './useVoiceCommands';

// Put your backend address here (same Wi-Fi as the phone).
const BACKEND_URL = 'http://192.168.18.51:8000';
const SESSION_ID = 'demo-session-1';
// Long-press the page counter to show the numbers used for tuning.
const DEBUG_DEFAULT = false;

const HINT_TEXT = {
  [HINT.NONE]: 'Hold steady over a page…',
  [HINT.NO_PAGE]: 'Point the camera at a page',
  [HINT.TOO_DARK]: 'More light please — page is dark',
  [HINT.MOVING]: 'Hold still…',
  [HINT.FOCUSING]: 'Focusing…',
  [HINT.STEADY]: 'Hold it… capturing',
  [HINT.NEXT_PAGE]: 'Show the next page',
  [HINT.MOVE_CLOSER]: 'Move a little closer — the page should fill about half the view',
};

const phaseSync = createSynchronizable(PHASE.IDLE);
const lastSampleSync = createSynchronizable(0);
const memSync = createSynchronizable(freshMemory());

export default function ScannerScreen({
  navigation,
  mode = 'paper',
  code = '',
  assessment = '',
}) {
  const { hasPermission, requestPermission } = useCameraPermission();
  // Ask for the multi-lens camera first: it includes the ultra-wide lens, so zooming
  // out (0.5x) can show the whole page from up close. A single normal lens cannot.
  const device = useCameraDevice('back', {
    physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'],
  });

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [viewMode, setViewMode] = useState('scanner');
  const [sessionActive, setSessionActive] = useState(false);
  const [pages, setPages] = useState([]);
  const [status, setStatus] = useState({ text: 'Tap "Start scanning" to begin', tone: 'info' });
  const [guide, setGuide] = useState('idle'); // idle | steady | ok | bad
  const [hud, setHud] = useState(null);
  const [showDebug, setShowDebug] = useState(DEBUG_DEFAULT);
  const [cameraError, setCameraError] = useState(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [upload, setUpload] = useState(null); // { done, total, finished, uploaded }
  const [lastThumb, setLastThumb] = useState(null);
  const [checkEach, setCheckEach] = useState(false); // preview every page with Keep / Retake (chip to turn on)
  const [wideView, setWideView] = useState(true); // wider lens when the phone has one (see zoom below)
  const [cameraReady, setCameraReady] = useState(false); // true once the camera has started running
  const [review, setReview] = useState(null); // page waiting for Keep / Retake
  const [retakeOffer, setRetakeOffer] = useState(null); // { file, number } for a few seconds
  const [skipOffer, setSkipOffer] = useState(null); // skipped look-alike page, "Keep it anyway" for a few seconds

  const sessionActiveRef = useRef(false);
  const pagesRef = useRef([]);
  const busyRef = useRef(false);
  const reviewRef = useRef(null);
  const checkEachRef = useRef(false);
  checkEachRef.current = checkEach;
  const toastTimer = useRef(null);
  const retakeTimer = useRef(null);
  const skipTimer = useRef(null);
  const flash = useRef(new Animated.Value(0)).current;

  // 'speed' throws on phones that don't support it, so only ask when supported.
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.QHD_4_3, // 1944x2592: small handwriting stays readable
    containerFormat: 'jpeg',
    qualityPrioritization: device?.supportsSpeedQualityPrioritization ? 'speed' : 'balanced',
    quality: 0.9,
  });

  // Page list lives in pageStore (pages.json); keep a copy for the UI.
  useEffect(() => {
    const apply = (m) => {
      pagesRef.current = m.pages;
      setPages(m.pages);
    };
    loadPages().then(apply);
    return subscribe(apply);
  }, []);

  const showToast = useCallback((msg, ms = 3500) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const say = useCallback((text, tone = 'info') => setStatus({ text, tone }), []);

  const flashScreen = useCallback(() => {
    flash.setValue(0.7);
    Animated.timing(flash, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  }, [flash]);

  // ----------------------------------------------------------------- upload
  const uploadPages = useCallback(async () => {
    if (upload && !upload.finished) return;
    setUpload({ done: 0, total: pagesRef.current.length, finished: false });
    const result = await uploadAll(BACKEND_URL, SESSION_ID, (done, total) =>
      setUpload({ done, total, finished: false })
    );
    setUpload({ ...result, done: result.total, finished: true });
    showToast(
      result.uploaded === result.total
        ? `Uploaded ${result.total} page(s) ✓`
        : `Uploaded ${result.uploaded} of ${result.total} — check Wi-Fi and tap Upload again`
    );
  }, [upload, showToast]);

  // --------------------------------------------------------------- capture
  const rearm = useCallback((phase, cooldownMs = 0, forgetPage = false) => {
    const m = memSync.getBlocking();
    memSync.setBlocking({
      ...m,
      cooldownUntil: Date.now() + cooldownMs,
      capturedSig: forgetPage ? null : m.prevSig,
      stillCount: 0,
    });
    phaseSync.setBlocking(sessionActiveRef.current ? phase : PHASE.IDLE);
  }, []);

  const showReview = useCallback((candidate) => {
    reviewRef.current = candidate;
    setReview(candidate);
  }, []);
  const closeReview = useCallback(() => {
    reviewRef.current = null;
    setReview(null);
  }, []);

  /** Keep a checked page (new page, or a sharper copy replacing an old one). */
  const keepPage = useCallback(
    async (c) => {
      const fields = {
        sharpness: c.analysis?.blur ?? null,
        fp: c.analysis?.fingerprint ?? null,
        cropped: !!c.analysis?.rect,
        skewDeg: c.analysis?.skewDeg ?? 0,
        text: c.ocr?.text ?? null,
        lineCount: c.ocr?.lines ?? 0,
        words: c.ocr?.words ?? 0,
        ocrStatus: c.ocr ? 'done' : 'failed',
        warning: c.verdict.ok ? c.verdict.warning ?? null : 'keptAnyway',
        manual: c.isManual,
        saving: false,
        uploaded: false,
      };
      let number;
      const old = c.replaces ? pagesRef.current[c.replaces - 1] : null;
      if (old) {
        await updatePage(old.file, { file: c.file, ...fields });
        discardPhoto(SCANS_DIR + old.file);
        number = c.replaces;
      } else {
        await addPage({ file: c.file, ...fields });
        number = pagesRef.current.length;
      }
      if (c.features) saveFeatures(c.file, c.features);
      setLastThumb(`${SCANS_DIR}${c.file}?t=${Date.now()}`);
      removeDuplicateOf(c.file, ({ removedNumber, keptNumber }) =>
        showToast(`Page ${removedNumber} was the same as page ${keptNumber} — removed (say "undo" to keep it)`, 5000)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setGuide('ok');
      if (old) say(`Page ${number} replaced with a sharper photo ✓ — show the next page`, 'ok');
      else if (c.verdict.warning === 'littleText') say(`Page ${number} saved — ${PROBLEM_TEXT.littleText}`, 'warn');
      else say(`Page ${number} saved ✓ — show the next page`, 'ok');
      if (!checkEachRef.current) {
        clearTimeout(retakeTimer.current);
        setRetakeOffer({ file: c.file, number });
        retakeTimer.current = setTimeout(() => setRetakeOffer(null), 4000);
      }
      rearm(PHASE.WAIT_NEW_PAGE, 0);
    },
    [rearm, say, showToast]
  );

  /** Throw a checked page away and ask for the same page again. */
  const dropPage = useCallback(
    (c, reason) => {
      discardPhoto(c.dest);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setGuide('bad');
      say(reason ? `${PROBLEM_TEXT[reason]} — not saved` : 'Retake: hold steady over the page', 'warn');
      rearm(PHASE.READY, 700, true); // the same page may be captured again
    },
    [rearm, say]
  );

  /** Auto mode: a probable copy is skipped, with "Keep it anyway" for 4 s. */
  const offerSkipped = useCallback(
    (c) => {
      clearTimeout(skipTimer.current);
      setSkipOffer((prev) => {
        if (prev && prev.file !== c.file) discardPhoto(prev.dest);
        return c;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setGuide('bad');
      say(`Looks like page ${c.looksLike} again — skipped`, 'warn');
      skipTimer.current = setTimeout(() => {
        discardPhoto(c.dest);
        setSkipOffer((cur) => (cur && cur.file === c.file ? null : cur));
      }, 4000);
      rearm(PHASE.WAIT_NEW_PAGE, 0);
    },
    [rearm, say]
  );

  const onKeepSkipped = useCallback(async () => {
    const c = skipOffer;
    clearTimeout(skipTimer.current);
    setSkipOffer(null);
    if (c) await keepPage({ ...c, looksLike: null });
  }, [skipOffer, keepPage]);

  const capturePage = useCallback(
    async (isManual) => {
      if (busyRef.current || reviewRef.current) return;
      busyRef.current = true;
      phaseSync.setBlocking(PHASE.CAPTURING);
      clearTimeout(retakeTimer.current);
      setRetakeOffer(null);
      setGuide('steady');
      say('Capturing… hold still');

      let photo = null;
      try {
        photo = await photoOutput.capturePhotoToFile(
          { flashMode: 'off', enableShutterSound: false },
          {
            onDidCapturePhoto: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              flashScreen();
              say('Checking the page… keep still');
            },
          }
        );

        // 1. Look at the real pixels: page box, blur, fingerprint.
        let analysis = null;
        try {
          analysis = await analyzePhoto(photo.filePath);
          // Width of the photo as it appears on screen (portrait).
          const a = Math.min(photo.width, photo.height);
          const b = Math.max(photo.width, photo.height);
          analysis.photoWidth = analysis.aspect >= 1 ? a : b;
        } catch (err) {
          console.warn('Photo analysis failed:', err?.message);
        }

        // 2. Clearly blurry or already scanned? Decide before saving anything.
        // (Also for the shutter button: a manual shot is never thrown away, but the
        //  teacher is shown when it looks like a page already scanned.)
        const quickRaw = analysis ? checkNewPage(analysis, pagesRef.current) : { ok: true };
        const quick = isManual && !quickRaw.ok ? { ok: true, manualDuplicateOf: quickRaw.duplicateOf } : quickRaw;
        if (showDebug) {
          console.log(
            `[capture] blur=${analysis?.blur?.toFixed(3)} tilt=${analysis?.skewDeg?.toFixed(1)}° ` +
              `crop=${!!analysis?.rect} sim=${quick.similarity?.toFixed?.(2)} ${analysis?.ms}ms -> ${quick.ok ? 'ok' : quick.reason}`
          );
        }
        if (!quick.ok && quick.reason === 'blurry') {
          discardPhoto(photo.filePath);
          dropPage({ dest: null }, 'blurry');
          return;
        }
        if (!quick.ok && quick.reason === 'duplicate' && !quick.sharper) {
          discardPhoto(photo.filePath);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          setGuide('bad');
          say(`Already scanned (page ${quick.duplicateOf}) — show the next page`, 'warn');
          rearm(PHASE.WAIT_NEW_PAGE, 0);
          return;
        }

        // 3. Save the page and let the phone try to READ it.
        const file = await reserveFileName();
        const dest = SCANS_DIR + file;
        const geometry = analysis ?? { rect: null, aspect: Math.max(photo.width, photo.height) / Math.min(photo.width, photo.height) };
        const photoPath = photo.filePath;
        photo = null;
        // Saving + reading the text run natively; meanwhile JS finds the
        // feature points used for the duplicate check.
        const nativeWork = (async () => {
          await savePagePhoto(photoPath, geometry, dest);
          discardPhoto(photoPath);
          try {
            return await readPage(dest);
          } catch (err) {
            console.warn('Text recognition failed:', err?.message);
            return null;
          }
        })();
        // 3a. Feature points of the PAGE AREA, compared with EVERY earlier page.
        //     No text needed, so this is the fast duplicate check.
        const pages = pagesRef.current;
        const probe = { fp: analysis?.fingerprint ?? null, text: '' };
        const featureVerdicts = new Map();
        let features = null;
        if (analysis?.gray) {
          try {
            const region = cropGray(analysis.gray, analysis.grayW, analysis.grayH, analysis.rect);
            features = extractFeatures(region.gray, region.w, region.h);
          } catch (err) {
            console.warn('Feature points failed:', err?.message);
          }
          analysis.gray = null; // free memory
        }
        const replacing = !quick.ok && quick.reason === 'duplicate';
        if (features && !replacing && !quick.manualDuplicateOf) {
          for (const i of candidatePages(probe, pages)) {
            const other = await loadFeatures(pages[i].file);
            if (!other) continue;
            const r = matchFeatures(features, other);
            const verdict = pageVerdict(r);
            if (verdict) featureVerdicts.set(i, verdict);
            if (showDebug) console.log(`[capture] vs page ${i + 1}: ${r.inliers} matching points -> ${verdict ?? 'different'}`);
            if (verdict === 'same') break; // one sure copy is enough
          }
        }

        // A sure copy (by feature points) that is not clearly sharper is refused at
        // once, without waiting for the page to be saved and read. The copy is
        // removed when that work is done.
        const sureCopy =
          !isManual && !replacing && !quick.manualDuplicateOf ? findDuplicateOf(probe, pages, featureVerdicts) : null;
        if (sureCopy?.sure && !isSharperThan(analysis?.blur, pages[sureCopy.sure - 1])) {
          nativeWork.catch(() => {}).finally(() => discardPhoto(dest));
          if (showDebug) console.log('[capture] duplicate found by feature points', sureCopy.why);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          setGuide('bad');
          say(`Already scanned (page ${sureCopy.sure}) — show the next page`, 'warn');
          rearm(PHASE.WAIT_NEW_PAGE, 0);
          return;
        }

        // Auto-save and the page is clearly fine (sharp, no look-alike): keep it NOW.
        // Saving and text reading finish in the background; a page the phone can't
        // read is removed then, with a message. Blurry pages and look-alikes still
        // wait for the text, so they are never kept.
        const blurryNow = Number.isFinite(analysis?.blur) && analysis.blur < CLEANUP.BLUR_GOOD;
        const fastKeep =
          !checkEachRef.current && !isManual && !replacing && !quick.manualDuplicateOf && !sureCopy?.possible && !blurryNow;
        if (fastKeep) {
          await addPage({
            file,
            sharpness: analysis?.blur ?? null,
            fp: analysis?.fingerprint ?? null,
            cropped: !!analysis?.rect,
            skewDeg: analysis?.skewDeg ?? 0,
            text: null,
            lineCount: 0,
            words: 0,
            ocrStatus: 'pending',
            warning: null,
            manual: false,
            saving: false,
            uploaded: false,
          });
          if (features) saveFeatures(file, encodeFeatures(features));
          const number = pagesRef.current.length;
          setLastThumb(`${SCANS_DIR}${file}?t=${Date.now()}`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setGuide('ok');
          say(`Page ${number} saved ✓ — show the next page`, 'ok');
          rearm(PHASE.WAIT_NEW_PAGE, 0);
          finishReading(
            file,
            nativeWork,
            (ocr) => judgeReadability(ocr, analysis?.blur),
            (reason) => showToast(`Page removed — ${PROBLEM_TEXT[reason] ?? 'could not be read'}`, 5000),
            ({ removedNumber, keptNumber }) =>
              showToast(`Page ${removedNumber} was the same as page ${keptNumber} — removed (say "undo" to keep it)`, 5000)
          );
          return;
        }

        const ocr = await nativeWork;
        const verdict = ocr ? judgeReadability(ocr, analysis?.blur) : { ok: true, warning: 'notChecked' };
        if (showDebug) console.log('[capture] read', ocr && { words: ocr.words, lines: ocr.lines, lineH: ocr.medianLineHeight }, verdict);

        const candidate = {
          file,
          dest,
          analysis,
          ocr,
          verdict,
          isManual,
          replaces: !quick.ok && quick.reason === 'duplicate' ? quick.duplicateOf : null,
          features: features ? encodeFeatures(features) : null,
          looksLike: null, // page number this one may be a copy of
        };

        // 3b. Now that we know the TEXT, decide with the text too (the feature
        //     points were already compared above).
        if (quick.manualDuplicateOf) candidate.looksLike = quick.manualDuplicateOf;
        if (!candidate.replaces && !candidate.looksLike) {
          const textProbe = { fp: analysis?.fingerprint ?? null, text: ocr?.text ?? '' };
          const dup = findDuplicateOf(textProbe, pages, featureVerdicts);
          if (showDebug && dup) console.log('[capture] duplicate check', dup);
          if (dup?.sure && isManual) {
            candidate.looksLike = dup.sure; // teacher pressed the shutter: ask, don't drop
          } else if (dup?.sure) {
            const old = pages[dup.sure - 1];
            const sharper =
              verdict.ok && Number.isFinite(analysis?.blur) && Number.isFinite(old?.sharpness) &&
              analysis.blur > old.sharpness * 1.15;
            if (sharper) {
              candidate.replaces = dup.sure;
            } else {
              discardPhoto(dest);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
              setGuide('bad');
              say(`Already scanned (page ${dup.sure}) — show the next page`, 'warn');
              rearm(PHASE.WAIT_NEW_PAGE, 0);
              return;
            }
          } else if (dup?.possible) {
            candidate.looksLike = dup.possible;
          }
        }

        // 4. Ask the teacher (check-each mode or manual shot), or decide automatically.
        if (checkEachRef.current || isManual) {
          phaseSync.setBlocking(PHASE.IDLE);
          const good = verdict.ok && !candidate.looksLike;
          setGuide(good ? 'ok' : 'bad');
          say(
            candidate.looksLike
              ? `Looks like page ${candidate.looksLike} — is it the same page?`
              : verdict.ok
                ? 'Check the page'
                : PROBLEM_TEXT[verdict.reason],
            good ? 'ok' : 'warn'
          );
          showReview(candidate);
        } else if (!verdict.ok) {
          dropPage(candidate, verdict.reason);
        } else if (candidate.looksLike) {
          // Probably the same page again: don't keep it, but let the teacher
          // keep it with one tap for a few seconds (in case it really is new).
          offerSkipped(candidate);
        } else {
          await keepPage(candidate);
        }
      } catch (err) {
        console.warn('Capture failed:', err?.message ?? err);
        if (photo) discardPhoto(photo.filePath);
        setGuide('bad');
        say('Capture failed — hold steady, trying again…', 'warn');
        rearm(PHASE.READY, CONFIG.COOLDOWN_MS, true);
      } finally {
        busyRef.current = false;
      }
    },
    [photoOutput, keepPage, dropPage, offerSkipped, showReview, rearm, say, flashScreen, showDebug]
  );

  // Review card buttons
  const onKeep = useCallback(async () => {
    const c = reviewRef.current;
    if (!c) return;
    closeReview();
    await keepPage(c);
  }, [closeReview, keepPage]);

  const onRetake = useCallback(() => {
    const c = reviewRef.current;
    if (!c) return;
    closeReview();
    dropPage(c, null);
  }, [closeReview, dropPage]);

  const onSkipDuplicate = useCallback(() => {
    const c = reviewRef.current;
    if (!c) return;
    closeReview();
    discardPhoto(c.dest);
    setGuide('idle');
    say(`Skipped (same as page ${c.looksLike}) — show the next page`, 'info');
    rearm(PHASE.WAIT_NEW_PAGE, 0);
  }, [closeReview, rearm, say]);

  // "Retake" shortly after an automatic save: delete that page and scan it again.
  const onRetakeLast = useCallback(async () => {
    const offer = retakeOffer;
    clearTimeout(retakeTimer.current);
    setRetakeOffer(null);
    if (!offer) return;
    await deletePages([offer.file]);
    setGuide('idle');
    say(`Page ${offer.number} removed — hold steady over it again`, 'warn');
    rearm(PHASE.READY, 500, true);
  }, [retakeOffer, rearm, say]);

  // ---------------------------------------------------- frame analyser link
  const onTrigger = useCallback(() => {
    if (!sessionActiveRef.current) return;
    capturePage(false);
  }, [capturePage]);

  const onDebug = useCallback(
    (d) => {
      if (!sessionActiveRef.current || busyRef.current || reviewRef.current) return;
      setHud(d);
      if (d.phase === PHASE.READY) {
        setGuide(d.hint === HINT.STEADY ? 'steady' : 'idle');
        say(HINT_TEXT[d.hint] ?? HINT_TEXT[HINT.NONE], d.hint === HINT.TOO_DARK ? 'warn' : 'info');
      } else if (d.phase === PHASE.WAIT_NEW_PAGE) {
        // keep the "saved ✓" / "already scanned" message on screen
      }
    },
    [say]
  );

  const onFrame = useCallback(
    (frame) => {
      'worklet';
      try {
        const phase = phaseSync.getBlocking();
        if (phase !== PHASE.READY && phase !== PHASE.WAIT_NEW_PAGE) return;
        const now = Date.now();
        if (now - lastSampleSync.getBlocking() < CONFIG.SAMPLE_INTERVAL_MS) return;
        lastSampleSync.setBlocking(now);

        const planes = frame.getPlanes();
        if (planes.length === 0) return;
        const yPlane = planes[0];
        const features = computeFeatures(
          new Uint8Array(yPlane.getPixelBuffer()),
          yPlane.bytesPerRow,
          yPlane.width,
          yPlane.height
        );

        const result = stepAnalyzer(phase, memSync.getBlocking(), features, now);
        memSync.setBlocking(result.mem);
        if (phaseSync.getBlocking() === phase) phaseSync.setBlocking(result.phase);

        if (result.trigger) scheduleOnRN(onTrigger);
        if (result.debug.sendHud) scheduleOnRN(onDebug, result.debug);
      } finally {
        frame.dispose();
      }
    },
    [onTrigger, onDebug]
  );

  const frameOutput = useFrameOutput({
    targetResolution: CONFIG.FRAME_SIZE,
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame,
  });

  const outputs = useMemo(() => [photoOutput, frameOutput], [photoOutput, frameOutput]);

  // ------------------------------------------------------------ housekeeping
  // Ask for the camera only once the app is on screen. Asked too early, the camera
  // library throws "No Activity!" (an unhandled promise error). Errors are caught here,
  // and the Allow button can be used to try again.
  const askCameraPermission = useCallback(async () => {
    try {
      await requestPermission();
    } catch (err) {
      console.warn('Camera permission request failed:', err?.message ?? err);
    }
  }, [requestPermission]);

  useEffect(() => {
    if (hasPermission || !appActive) return undefined;
    const timer = setTimeout(askCameraPermission, 300);
    return () => clearTimeout(timer);
  }, [hasPermission, appActive, askCameraPermission]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => () => phaseSync.setBlocking(PHASE.IDLE), []);

  // The camera is only running while the scanner is on screen and the app is active.
  const liveCamera = appActive && viewMode === 'scanner';
  useEffect(() => {
    if (!liveCamera) setCameraReady(false);
  }, [liveCamera]);

  const handleCameraError = useCallback((error) => {
    const msg = error?.message ?? 'Unknown camera error';
    // Settings sent while the camera is paused or starting (e.g. zoom) are cancelled
    // by the camera library. Harmless: log it, don't show the error box.
    if (/not active/i.test(msg)) {
      console.warn('Camera busy, setting ignored:', msg);
      return;
    }
    console.warn('Camera error:', msg);
    setCameraError(msg);
  }, []);

  const retryCamera = () => {
    setCameraError(null);
    setCameraKey((k) => k + 1);
  };

  // ---------------------------------------------------------------- session
  const beginScanning = () => {
    setUpload(null);
    memSync.setBlocking(freshMemory());
    lastSampleSync.setBlocking(0);
    sessionActiveRef.current = true;
    setSessionActive(true);
    setGuide('idle');
    say(HINT_TEXT[HINT.NONE]);
    phaseSync.setBlocking(PHASE.READY);
  };

  const startNewSession = async () => {
    try {
      await resetSession();
    } catch (err) {
      console.warn('Could not prepare scans folder:', err?.message);
    }
    setLastThumb(null);
    beginScanning();
  };

  const stopScanning = () => {
    if (reviewRef.current) {
      discardPhoto(reviewRef.current.dest);
      closeReview();
    }
    phaseSync.setBlocking(PHASE.IDLE);
    sessionActiveRef.current = false;
    setSessionActive(false);
    setGuide('idle');
    setHud(null);
  };

  const endSession = () => {
    stopScanning();
    setViewMode('gallery');
  };

  // ---------------------------------------------------------- voice commands
  const handleVoiceCommand = useCallback(
    async (command) => {
      try {
        const msg = await runPageCommand(command);
        if (msg) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          showToast(msg);
          return;
        }
        if (command.action === 'capture') {
          if (sessionActiveRef.current) capturePage(true);
          else showToast('Start scanning first');
        } else if (command.action === 'endSession') {
          if (sessionActiveRef.current) endSession();
          else showToast('No session running');
        } else if (command.action === 'upload') {
          if (sessionActiveRef.current) stopScanning();
          setViewMode('gallery');
          uploadPages();
        }
      } catch (err) {
        console.warn('Voice command failed:', err?.message);
        showToast('Sorry, that did not work');
      }
    },
    // endSession/stopScanning only touch refs and setters, safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, uploadPages, capturePage]
  );

  const voice = useVoiceCommands(handleVoiceCommand);

  // --------------------------------------------------------------------- UI
 if (viewMode === 'gallery') {
  return (
    <GalleryScreen
      pages={pages}
      voice={voice}
      toast={toast}
      upload={upload}
      onUpload={uploadPages}
      onCommand={handleVoiceCommand}
      onClose={() => setViewMode('scanner')}
    onContinueToFolders={() => navigation.replace('Folders')}
    // onContinueToFolders={() => navigation.replace('Home')}

    />
  );
}

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Looking for a back camera…</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Camera access is needed to scan pages.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={askCameraPermission}>
          <Text style={styles.btnText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Zoom: the default used to sit on the zoomed-in lens. 1x = the phone's normal
  // lens; if the phone has a wider lens (0.5x) the teacher can use it to stand
  // further from the page.
  const neutralZoom = device?.neutralZoom ?? 1;
  const minZoom = device?.minZoom ?? neutralZoom;
  const canWiden = minZoom < neutralZoom * 0.95;
  const cameraZoom = canWiden && wideView ? minZoom : neutralZoom;

  const guideColor = {
    idle: 'rgba(255,255,255,0.75)',
    steady: '#facc15',
    ok: '#22c55e',
    bad: '#f97316',
  }[guide];
  const pageCount = pages.length;
  const checking = pages.filter((p) => p.saving || p.ocrStatus === 'pending').length;

  return (
    <View style={styles.container}>
      <Camera
        key={cameraKey}
        style={StyleSheet.absoluteFill}
        device={device}
        // 'contain' shows the whole picture the photo is taken from. The default
        // ('cover') crops the sides on a tall phone screen, so the page looked zoomed in.
        resizeMode="contain"
        zoom={cameraReady && canWiden ? cameraZoom : undefined}
        isActive={appActive && viewMode === 'scanner'}
        outputs={outputs}
        onStarted={() => {
          setCameraError(null);
          setCameraReady(true);
        }}
        onError={handleCameraError}
      />

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />

      {sessionActive && <View pointerEvents="none" style={[styles.guide, { borderColor: guideColor }]} />}

      {/* Top bar: page count (long-press = tuning numbers) and voice */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onLongPress={() => setShowDebug((v) => !v)}
          onPress={() => pageCount > 0 && setViewMode('gallery')}
          style={styles.counter}
          accessibilityLabel={`${pageCount} pages scanned. Tap to review.`}
        >
          <Text style={styles.counterText}>{pageCount} page{pageCount === 1 ? '' : 's'}</Text>
          {checking > 0 && <Text style={styles.counterSub}>reading {checking}…</Text>}
        </TouchableOpacity>
        <View style={styles.topRight}>
          {canWiden && (
            <TouchableOpacity
              style={[styles.chip, wideView && styles.chipOn]}
              onPress={() => setWideView((v) => !v)}
              accessibilityLabel={wideView ? 'Wide view on' : 'Wide view off'}
            >
              <Text style={styles.micText}>{(cameraZoom / neutralZoom).toFixed(1)}×</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.chip, checkEach && styles.chipOn]}
            onPress={() => setCheckEach((v) => !v)}
            accessibilityLabel={checkEach ? 'Checking each page: on' : 'Checking each page: off'}
          >
            <Text style={styles.micText}>{checkEach ? '✓ Check each page' : 'Auto save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.micButton, voice.micOn && styles.micButtonOn]}
            onPress={voice.toggle}
            accessibilityLabel={voice.micOn ? 'Turn voice commands off' : 'Turn voice commands on'}
          >
            <Text style={styles.micText}>{voice.micOn ? '🎙️ On' : '🎙️'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {(toast || (voice.micOn && voice.heard) || voice.error) && (
        <View style={styles.voiceToast} pointerEvents="none">
          {voice.micOn && voice.heard ? <Text style={styles.voiceHeard}>Heard: “{voice.heard}”</Text> : null}
          {toast ? <Text style={styles.voiceResult}>{toast}</Text> : null}
          {voice.error ? <Text style={styles.voiceError}>{voice.error}</Text> : null}
        </View>
      )}

      {cameraError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Camera problem</Text>
          <Text style={styles.errorText}>{cameraError}</Text>
          <Text style={styles.errorHint}>
            Check that camera access is ON (Settings → Apps → Permissions) and no other app is using the camera.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={retryCamera}>
            <Text style={styles.btnText}>Retry camera</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={[
            styles.statusPill,
            status.tone === 'ok' && styles.statusOk,
            status.tone === 'warn' && styles.statusWarn,
          ]}
          pointerEvents="none"
        >
          <Text style={styles.statusText}>{status.text}</Text>
        </View>
      )}

      {showDebug && sessionActive && hud && (
        <View style={styles.hud} pointerEvents="none">
          <Text style={styles.hudText}>
            moved {hud.shift}px · steady {hud.still}/{CONFIG.STILL_SAMPLES} · focus {hud.focus.toFixed(2)} (min{' '}
            {CONFIG.MIN_FOCUS})
          </Text>
          <Text style={styles.hudText}>
            page fills {Math.round(hud.coverage * 100)}% (min {Math.round(CONFIG.MIN_COVERAGE * 100)}%) · paper{' '}
            {hud.luma.toFixed(0)} (min {CONFIG.MIN_PAPER_LUMA})
          </Text>
          <Text style={styles.hudText}>
            change vs saved page {hud.dist.toFixed(1)} (new page &gt; {CONFIG.REARM_DIST})
          </Text>
        </View>
      )}

      {retakeOffer && !review && (
        <TouchableOpacity style={styles.retakeLast} onPress={onRetakeLast} accessibilityLabel={`Retake page ${retakeOffer.number}`}>
          <Text style={styles.btnText}>↺ Retake page {retakeOffer.number}</Text>
        </TouchableOpacity>
      )}

      {skipOffer && !review && (
        <TouchableOpacity style={styles.retakeLast} onPress={onKeepSkipped} accessibilityLabel="Keep the skipped page">
          <Text style={styles.btnText}>It's a new page — keep it</Text>
        </TouchableOpacity>
      )}

      {review && (
        <View style={styles.reviewBackdrop}>
          <View style={styles.reviewCard}>
            {review.looksLike && pages[review.looksLike - 1] ? (
              <View style={styles.compareRow}>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel}>New photo</Text>
                  <Image source={{ uri: review.dest }} style={styles.compareImage} resizeMode="contain" />
                </View>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel}>Page {review.looksLike}</Text>
                  <Image
                    source={{ uri: SCANS_DIR + pages[review.looksLike - 1].file }}
                    style={styles.compareImage}
                    resizeMode="contain"
                  />
                </View>
              </View>
            ) : (
              <Image source={{ uri: review.dest }} style={styles.reviewImage} resizeMode="contain" />
            )}
            <View style={[styles.verdict, review.verdict.ok && !review.looksLike ? styles.verdictOk : styles.verdictBad]}>
              <Text style={styles.verdictTitle}>
                {review.looksLike
                  ? `⚠ Looks like page ${review.looksLike} — same page?`
                  : review.verdict.ok
                  ? review.verdict.warning === 'littleText'
                    ? '⚠ Hardly any text found'
                    : review.verdict.warning === 'notChecked'
                      ? 'Could not check the text'
                      : '✓ Text is readable'
                  : `✕ ${PROBLEM_TEXT[review.verdict.reason]}`}
              </Text>
              <Text style={styles.verdictSub}>
                {review.ocr
                  ? `${review.ocr.words} words read · ${review.ocr.lines} lines`
                  : 'Text will be read later'}
                {review.replaces ? ` · sharper copy of page ${review.replaces}` : ''}
              </Text>
            </View>
            {review.looksLike ? (
              <View style={styles.reviewButtons}>
                <TouchableOpacity style={[styles.reviewBtn, styles.primaryBtnSolid]} onPress={onSkipDuplicate}>
                  <Text style={styles.btnText}>Same page — skip</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.reviewBtn, styles.secondaryBtn]} onPress={onKeep}>
                  <Text style={styles.btnText}>New page — keep</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.reviewButtons}>
                <TouchableOpacity
                  style={[styles.reviewBtn, review.verdict.ok ? styles.secondaryBtn : styles.primaryBtnSolid]}
                  onPress={onRetake}
                >
                  <Text style={styles.btnText}>↺ Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.reviewBtn, review.verdict.ok ? styles.keepBtn : styles.secondaryBtn]}
                  onPress={onKeep}
                >
                  <Text style={styles.btnText}>{review.verdict.ok ? '✓ Keep' : 'Keep anyway'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      <View style={styles.bottomBar}>
        {!sessionActive ? (
          <View style={styles.startCol}>
            <TouchableOpacity style={styles.primaryBtn} onPress={pageCount ? beginScanning : startNewSession}>
              <Text style={styles.btnText}>{pageCount ? `Continue scanning (${pageCount})` : 'Start scanning'}</Text>
            </TouchableOpacity>
            {pageCount > 0 && (
              <View style={styles.linkRow}>
                <TouchableOpacity onPress={() => setViewMode('gallery')} style={styles.linkBtn}>
                  <Text style={styles.linkText}>Review pages</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={startNewSession} style={styles.linkBtn}>
                  <Text style={styles.linkText}>Start a new session</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.activeRow}>
            <TouchableOpacity
              style={styles.thumbSlot}
              onPress={() => setViewMode('gallery')}
              disabled={!lastThumb}
              accessibilityLabel="Review scanned pages"
            >
              {lastThumb ? <Image source={{ uri: lastThumb }} style={styles.thumb} /> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.shutter} onPress={() => capturePage(true)} accessibilityLabel="Capture now">
              <View style={styles.shutterInner} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneBtn} onPress={endSession}>
              <Text style={styles.btnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#000' },
  infoText: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  flash: { backgroundColor: '#fff' },
  guide: {
    position: 'absolute',
    top: '13%',
    bottom: '22%',
    left: '7%',
    right: '7%',
    borderWidth: 3,
    borderRadius: 16,
  },
  topBar: {
    position: 'absolute',
    top: 48,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  counter: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 44,
    justifyContent: 'center',
  },
  counterText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  counterSub: { color: '#cbd5e1', fontSize: 11 },
  statusPill: {
    position: 'absolute',
    bottom: 150,
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
  },
  statusOk: { backgroundColor: 'rgba(22,130,60,0.9)' },
  statusWarn: { backgroundColor: 'rgba(194,90,10,0.92)' },
  statusText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  errorBox: {
    position: 'absolute',
    top: '30%',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(120,20,20,0.92)',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  errorTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  errorText: { color: '#fff', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  errorHint: { color: '#fecaca', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  hud: {
    position: 'absolute',
    top: 150,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 10,
  },
  hudText: { color: '#a7f3d0', fontSize: 12, fontFamily: 'monospace' },
  bottomBar: {
    position: 'absolute',
    bottom: 36,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbSlot: { width: 64, height: 80, justifyContent: 'center' },
  thumb: { width: 56, height: 74, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: '#333' },
  startCol: { alignItems: 'center' },
  linkRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  activeRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  primaryBtn: { backgroundColor: '#2563eb', paddingHorizontal: 26, paddingVertical: 15, borderRadius: 30, minHeight: 50 },
  doneBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 30, borderWidth: 1, borderColor: '#fff' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  linkBtn: { padding: 10 },
  linkText: { color: '#cbd5e1', fontSize: 14, textDecorationLine: 'underline' },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  micButton: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 44,
    justifyContent: 'center',
  },
  micButtonOn: { backgroundColor: 'rgba(220,38,38,0.85)' },
  topRight: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: 'rgba(22,130,60,0.85)' },
  retakeLast: {
    position: 'absolute',
    bottom: 200,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderColor: '#fff',
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 26,
  },
  reviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    padding: 16,
  },
  reviewCard: { backgroundColor: '#111827', borderRadius: 18, overflow: 'hidden' },
  reviewImage: { width: '100%', height: 420, backgroundColor: '#000' },
  compareRow: { flexDirection: 'row', gap: 6, backgroundColor: '#000', padding: 6 },
  compareCol: { flex: 1 },
  compareLabel: { color: '#cbd5e1', fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  compareImage: { width: '100%', height: 360 },
  verdict: { paddingHorizontal: 16, paddingVertical: 12 },
  verdictOk: { backgroundColor: '#14532d' },
  verdictBad: { backgroundColor: '#7c2d12' },
  verdictTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  verdictSub: { color: '#e5e7eb', fontSize: 13, marginTop: 2 },
  reviewButtons: { flexDirection: 'row', gap: 12, padding: 14 },
  reviewBtn: { flex: 1, minHeight: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  keepBtn: { backgroundColor: '#16a34a' },
  primaryBtnSolid: { backgroundColor: '#2563eb' },
  secondaryBtn: { backgroundColor: '#374151' },
  micText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  voiceToast: {
    position: 'absolute',
    top: 104,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.72)',
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  voiceHeard: { color: '#cbd5e1', fontSize: 13, fontStyle: 'italic' },
  voiceResult: { color: '#86efac', fontSize: 15, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  voiceError: { color: '#fca5a5', fontSize: 13, marginTop: 2 },
});