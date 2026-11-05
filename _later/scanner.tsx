// SCANNER SCREEN (route: /scanner)
// Opened from the home screen with:  mode = "paper" (question paper) or "students" (answer pages),
// code = class code, assessment = "<class code> <quiz name>".
// Each captured page is shrunk, sent to n8n, and the result is remembered for the home screen.
import React, { useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, Button } from "react-native";

import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  useFrameOutput,
} from "react-native-vision-camera";

import {
  OpenCV,
  Mat,
  MatVector,
  DataTypes,
  RetrievalModes,
  ContourApproximationModes,
} from "react-native-fast-opencv";

import { useSharedValue, runOnJS } from "react-native-reanimated";

import { useLocalSearchParams, useRouter } from "expo-router";
import { loadSession, saveSession } from "@/lib/session";
import { sendPage, shrink, sayFlags } from "@/lib/upload";


// ============================================================
// SETTINGS
// ============================================================

// Analyse 1 camera frame out of every N (higher = lighter on the phone)
const PROCESS_EVERY_N_FRAMES = 3;

// Stable checks in a row before auto-capture
const STABLE_FRAMES_REQUIRED = 3;

// How far each corner may move (pixels) and still count as "still"
const CORNER_MOVEMENT_TOLERANCE = 18;

// Ignore small shapes
const MIN_DOCUMENT_AREA = 20000;

// Keep corners away from the camera edge
const BORDER_MARGIN = 20;

// Canny edge detection
const CANNY_LOW = 75;
const CANNY_HIGH = 200;


// ============================================================
// HELPERS (these run inside the camera worklet)
// ============================================================

function distance(p1: any, p2: any) {
  "worklet";
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getAngle(a: any, b: any, c: any) {
  "worklet";
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.sqrt(abx * abx + aby * aby);
  const magCB = Math.sqrt(cbx * cbx + cby * cby);
  if (magAB === 0 || magCB === 0) return 0;
  let cosine = dot / (magAB * magCB);
  cosine = Math.max(-1, Math.min(1, cosine));
  return Math.acos(cosine) * (180 / Math.PI);
}

function isDocumentQuad(points: any[], frameWidth: number, frameHeight: number) {
  "worklet";
  if (!points || points.length !== 4) return false;

  for (const point of points) {
    if (
      point.x < BORDER_MARGIN ||
      point.y < BORDER_MARGIN ||
      point.x > frameWidth - BORDER_MARGIN ||
      point.y > frameHeight - BORDER_MARGIN
    ) {
      return false;
    }
  }

  const shortestSide = Math.min(
    distance(points[0], points[1]),
    distance(points[1], points[2]),
    distance(points[2], points[3]),
    distance(points[3], points[0])
  );
  if (shortestSide < 80) return false;

  const angles = [
    getAngle(points[3], points[0], points[1]),
    getAngle(points[0], points[1], points[2]),
    getAngle(points[1], points[2], points[3]),
    getAngle(points[2], points[3], points[0]),
  ];
  for (const angle of angles) {
    if (angle < 45 || angle > 135) return false;
  }

  return true;
}


// ============================================================
// MAIN APP
// ============================================================

export default function Scanner() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const photoOutput = usePhotoOutput();
  const router = useRouter();
  const { mode, assessment } = useLocalSearchParams<{ mode: string; code: string; assessment: string }>();
  const isPaper = mode === "paper";
  const quiz = String(assessment ?? "Quiz");

  const [pageCount, setPageCount] = useState(0);        // pages captured in this visit
  const pageCountRef = useRef(0);                       // same number, safe to read inside callbacks
  const [isWatching, setIsWatching] = useState(false);
  const [status, setStatus] = useState(
    isPaper ? "Hold the question paper in view, then press Start." : "Press Start, then show each student's page."
  );
  const isCapturingRef = useRef(false);

  const lastCorners = useSharedValue<any>(null);
  const stableCount = useSharedValue(0);
  const hasTriggered = useSharedValue(false);
  const frameCounter = useSharedValue(0);
  // 0 = nothing shown yet, 1 = "looking", 2 = "document detected"
  const lastStatusCode = useSharedValue(0);

  const updateDebug = useCallback((text: string) => {
    setStatus(text);
  }, []);

  // Sends one captured photo to n8n and remembers the result (runs in the background,
  // so the next page can be shown while this one is being read).
  const processPage = useCallback(
    async (rawUri: string, pageNo: number) => {
      try {
        const uri = await shrink(rawUri);
        const reply = await sendPage(isPaper ? "paper" : "student", uri, quiz, `${Date.now()}-${pageNo}`);
        const session = await loadSession(quiz);
        const problems = sayFlags(reply.flags);
        session.pages += 1;
        if (isPaper) {
          session.paper = { questions: reply.questions ?? [], flags: reply.flags ?? [] };
          await saveSession(quiz, session);
          setStatus(
            problems
              ? "Question paper saved. Please check: " + problems
              : "Question paper read and saved."
          );
          setIsWatching(false);
          setTimeout(() => router.back(), 1200);
        } else {
          if (reply.sap_id) session.scanned[reply.sap_id] = reply.student_name ?? "";
          if (problems) session.flaggedPages += 1;
          await saveSession(quiz, session);
          const who = reply.student_name || reply.sap_id || "page";
          setStatus(problems ? who + " saved. Check: " + problems : who + " saved. Show the next page.");
        }
      } catch (err: any) {
        console.error("UPLOAD FAILED:", err);
        setStatus("Could not send the page. Check your internet and scan it again.");
      }
    },
    [isPaper, quiz, router]
  );

  const triggerCapture = useCallback(async () => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;
    setStatus("Capturing...");
    try {
      const photo = await photoOutput.capturePhoto({ flashMode: "off" }, {});
      const path = await photo.saveToTemporaryFileAsync();
      pageCountRef.current += 1;
      const next = pageCountRef.current;
      setPageCount(next);
      setStatus("Reading the page...");
      processPage("file://" + path, next); // not awaited on purpose
    } catch (err: any) {
      console.error("AUTO CAPTURE FAILED:", err);
      setStatus("Capture failed. Try again.");
      hasTriggered.value = false;
    } finally {
      isCapturingRef.current = false;
    }
  }, [photoOutput, processPage]);

  const frameOutput = useFrameOutput({
    pixelFormat: "yuv",
    dropFramesWhileBusy: true,
    // Analyse a small image (640x480) instead of the full camera size.
    // Much less data per frame = much faster. The saved photo is still full quality.
    targetResolution: { width: 640, height: 480 },

    onFrame(frame) {
      "worklet";
      frameCounter.value += 1;

      // Skip most frames. Disposing is required for every frame we skip.
      if (frameCounter.value % PROCESS_EVERY_N_FRAMES !== 0) {
        frame.dispose();
        return;
      }

      let step = "start";

      try {
        step = "getPlanes";
        const planes = frame.getPlanes();
        if (planes.length === 0) return; // finally{} below disposes the frame

        step = "yPlane";
        const yPlane = planes[0];
        const rows = yPlane.height;
        const cols = yPlane.bytesPerRow;

        step = "getPixelBuffer";
        const yData = new Uint8Array(yPlane.getPixelBuffer());

        step = "createGrayMat";
        const gray = Mat.createFromVisionCameraFrameBuffer(rows, cols, 1, yData);

        step = "createEdges";
        const edges = Mat.create(rows, cols, DataTypes.CV_8U);

        step = "Canny";
        OpenCV.Canny(gray, edges, CANNY_LOW, CANNY_HIGH);

        step = "findContours";
        const contours = MatVector.create();
        OpenCV.findContours(
          edges,
          contours,
          RetrievalModes.RETR_EXTERNAL,
          ContourApproximationModes.CHAIN_APPROX_SIMPLE
        );

        step = "findDocument";
        const frameWidth = yPlane.width;
        const frameHeight = yPlane.height;

        let bestDocument: any[] | null = null;
        let bestArea = 0;

        for (let i = 0; i < contours.length; i++) {
          const contour = contours.get(i);

          const rect = OpenCV.boundingRect(contour);
          const roughArea = rect.width * rect.height;
          if (roughArea < MIN_DOCUMENT_AREA) continue;

          step = "arcLength";
          const perimeter = OpenCV.arcLength(contour, true);
          if (perimeter <= 0) continue;

          step = "approxPolyDP";
          const approx = OpenCV.approxPolyDP(contour, 0.02 * perimeter, true);
          if (!approx) continue;
          if (approx.length !== 4) continue;

          const corners = [];
          for (let j = 0; j < approx.length; j++) {
            const point = approx.get(j);
            corners.push({ x: point.x, y: point.y });
          }

          if (!isDocumentQuad(corners, frameWidth, frameHeight)) continue;

          if (roughArea > bestArea) {
            bestArea = roughArea;
            bestDocument = corners;
          }
        }

        step = "status";
        // Only touch the screen when the message actually changes.
        const code = bestDocument === null ? 1 : 2;
        if (lastStatusCode.value !== code && !hasTriggered.value) {
          lastStatusCode.value = code;
          runOnJS(updateDebug)(
            code === 1
              ? "Looking for a document..."
              : "Document detected — hold still..."
          );
        }

        step = "documentStability";
        if (bestDocument === null) {
          // No page in view (e.g. mid-flip): unlock for the next page.
          lastCorners.value = null;
          stableCount.value = 0;
          hasTriggered.value = false;
        } else if (lastCorners.value === null) {
          lastCorners.value = bestDocument;
          stableCount.value = 1;
        } else {
          const previous = lastCorners.value;
          let maximumMovement = 0;
          for (let i = 0; i < 4; i++) {
            maximumMovement = Math.max(
              maximumMovement,
              distance(previous[i], bestDocument[i])
            );
          }

          if (maximumMovement <= CORNER_MOVEMENT_TOLERANCE) {
            stableCount.value += 1;
          } else {
            stableCount.value = 1;
          }

          lastCorners.value = bestDocument;

          if (stableCount.value >= STABLE_FRAMES_REQUIRED && !hasTriggered.value) {
            hasTriggered.value = true; // lock: no duplicate photos of this page
            runOnJS(triggerCapture)();
          }
        }
      } catch (err: any) {
        if (frameCounter.value % (PROCESS_EVERY_N_FRAMES * 5) === 0) {
          runOnJS(updateDebug)(
            "Scanner error at [" + step + "]: " + String(err?.message ?? err)
          );
        }
      } finally {
        // Free EVERY native OpenCV object created during this frame
        // (Mats, contour lists, polygons). Without this, memory grows
        // with every frame and the phone slows down and hangs.
        try {
          OpenCV.clearBuffers();
        } catch (e) {}
        frame.dispose();
      }
    },
  });

  function startWatching() {
    lastCorners.value = null;
    stableCount.value = 0;
    hasTriggered.value = false;
    lastStatusCode.value = 0;
    isCapturingRef.current = false;
    setIsWatching(true);
    setStatus("Looking for a document...");
  }

  function stopWatching() {
    setIsWatching(false);
    setStatus("Stopped. " + pageCount + " pages scanned.");
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text>Camera permission needed</Text>
        <Button title="Grant permission" onPress={() => requestPermission()} />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text>No camera device found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={isWatching ? [photoOutput, frameOutput] : [photoOutput]}
      />

      <View style={styles.topBar}>
        <Text style={styles.statusText}>{status}</Text>
        <Text style={styles.countText}>{pageCount} pages scanned</Text>
      </View>

      <View style={styles.bottomBar}>
        {!isWatching ? (
          <Button title="Start Scanner" onPress={startWatching} />
        ) : (
          <Button title="Stop" onPress={stopWatching} color="red" />
        )}
        <View style={{ height: 12 }} />
        <Button title="Done" onPress={() => router.back()} />
      </View>
    </View>
  );
}


// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  topBar: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  statusText: {
    color: "white",
    fontSize: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    textAlign: "center",
  },
  countText: {
    color: "white",
    fontSize: 13,
    marginTop: 4,
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  bottomBar: {
    position: "absolute",
    bottom: 60,
    width: "100%",
    alignItems: "center",
  },
});
