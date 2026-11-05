// screens/useVoiceCommands.js
//
// Hands-free commands ("capture", "delete last page", "undo", "upload", ...).
// Uses the phone's speech recogniser through expo-speech-recognition and keeps
// listening until the user turns the mic off or says "stop listening".
// Android ends a recognition session after silence, so we restart it ourselves.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { parseCommand } from './pageLogic.js';

// Help the recogniser expect our words.
const HINTS = [
  'capture',
  'scan now',
  'delete duplicates',
  'delete blurry pages',
  'clean up',
  'delete last page',
  'delete page',
  'undo',
  'upload',
  'end session',
  'stop listening',
];

/**
 * onCommand(command, transcript) is called for every recognised command.
 * Returns { micOn, listening, heard, error, start, stop, toggle }.
 */
export default function useVoiceCommands(onCommand) {
  const [micOn, setMicOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState(null);
  const wantRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const lastRunRef = useRef({ text: '', at: 0 });
  const restartTimer = useRef(null);

  const begin = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        continuous: true, // Android 13+; older phones get restarted on 'end'
        contextualStrings: HINTS,
      });
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, []);

  const start = useCallback(async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone permission is off');
      return;
    }
    setError(null);
    wantRef.current = true;
    setMicOn(true);
    begin();
  }, [begin]);

  const stop = useCallback(() => {
    wantRef.current = false;
    clearTimeout(restartTimer.current);
    setMicOn(false);
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
    setListening(false);
  }, []);

  const toggle = useCallback(() => (wantRef.current ? stop() : start()), [start, stop]);

  useSpeechRecognitionEvent('start', () => setListening(true));

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    if (wantRef.current) {
      clearTimeout(restartTimer.current);
      restartTimer.current = setTimeout(() => wantRef.current && begin(), 250);
    }
  });

  useSpeechRecognitionEvent('error', (e) => {
    // "no-speech" / "speech-timeout" just mean silence: 'end' will restart us.
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wantRef.current = false;
      setMicOn(false);
      setError('Microphone or speech recognition is not allowed');
    } else if (e.error !== 'no-speech' && e.error !== 'speech-timeout' && e.error !== 'aborted') {
      setError(e.message || e.error);
    }
  });

  useSpeechRecognitionEvent('result', (e) => {
    if (!e.isFinal) return;
    const transcript = (e.results?.[0]?.transcript || '').trim();
    if (!transcript) return;
    setHeard(transcript);

    // The recogniser sometimes repeats the same final result; run it once.
    const now = Date.now();
    if (transcript === lastRunRef.current.text && now - lastRunRef.current.at < 2500) return;
    lastRunRef.current = { text: transcript, at: now };

    const command = parseCommand(transcript);
    if (!command) return;
    if (command.action === 'stopListening') {
      stop();
      return;
    }
    onCommandRef.current?.(command, transcript);
  });

  useEffect(
    () => () => {
      wantRef.current = false;
      clearTimeout(restartTimer.current);
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
    },
    []
  );

  return { micOn, listening, heard, error, start, stop, toggle };
}
