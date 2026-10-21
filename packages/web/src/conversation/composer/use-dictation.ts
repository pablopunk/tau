import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal surface of the browser speech API we use; avoids depending on lib.dom extras. */
interface DictationAlternative {
  readonly transcript: string;
}
interface DictationResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: DictationAlternative;
}
interface DictationResultList {
  readonly length: number;
  readonly [index: number]: DictationResult;
}
interface DictationResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: DictationResultList;
}
interface DictationRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: DictationResultEvent) => void) | null;
  onerror: ((event: Event & { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => DictationRecognition;
    webkitSpeechRecognition?: new () => DictationRecognition;
  }
}

export interface Dictation {
  /** True while the microphone is open. */
  readonly listening: boolean;
  /** The current unfinished sentence, for live feedback while talking. */
  readonly preview: string;
  readonly toggle: () => void;
  /** The glow overlay; the volume loop paints it directly, no re-renders. */
  readonly glowRef: React.RefObject<HTMLDivElement | null>;
}

interface Running {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly source: MediaStreamAudioSourceNode;
  readonly analyser: AnalyserNode;
  readonly samples: Uint8Array<ArrayBuffer>;
  readonly recognition: DictationRecognition | null;
  frame: number;
  smoothed: number;
}

const FFT_SIZE = 1024;
const GAIN = 5;
/** Exponent below 1 lifts quiet sounds so the glow answers sooner. */
const CURVE = 0.7;
const SMOOTHING = 0.8;
const GLOW_RGB = "96, 165, 250";

/** Root-mean-square of the time-domain samples, roughly 0 for silence. */
function rms(analyser: AnalyserNode, samples: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const centered = ((samples[i] ?? 128) - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * GAIN) ** CURVE;
}

function paint(glow: HTMLDivElement | null, level: number) {
  if (!glow) return;
  glow.style.opacity = (0.3 + level * 0.7).toFixed(3);
  glow.style.boxShadow = `0 0 ${(18 + level * 54).toFixed(0)}px ${(4 + level * 12).toFixed(0)}px rgba(${GLOW_RGB}, ${(0.4 + level * 0.5).toFixed(3)})`;
}

function unpaint(glow: HTMLDivElement | null) {
  if (!glow) return;
  glow.style.opacity = "0";
  glow.style.boxShadow = "none";
}

/**
 * Toggle dictation: opens the mic, streams final transcripts to `onText`,
 * and paints the glow overlay with the live input volume. Speech
 * recognition needs a supporting browser; the volume glow works anywhere
 * `getUserMedia` does. Transcription is best-effort: without recognition
 * support the toggle still opens the mic and glows, but yields no text.
 */
export function useDictation(onText: (text: string) => void, onError: (message: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState("");
  const glowRef = useRef<HTMLDivElement | null>(null);
  const running = useRef<Running | null>(null);
  const wantListening = useRef(false);
  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };

  const stop = useCallback(() => {
    wantListening.current = false;
    const current = running.current;
    running.current = null;
    if (current) {
      cancelAnimationFrame(current.frame);
      try {
        current.recognition?.stop();
      } catch {
        // Already stopped; teardown continues below.
      }
      for (const track of current.stream.getTracks()) track.stop();
      void current.context.close().catch(() => undefined);
    }
    unpaint(glowRef.current);
    setListening(false);
    setPreview("");
  }, []);

  const start = useCallback(async () => {
    wantListening.current = true;
    // Start recognition synchronously in the tap gesture: Chrome rejects
    // start() once transient activation expires (e.g. after awaiting a
    // permission prompt), and it reports nothing when that throw is swallowed.
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
    const recognition = Recognition ? new Recognition() : null;
    if (recognition) {
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language;
      recognition.onresult = (event) => {
        let text = "";
        let draft = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const first = result?.[0];
          if (!first) continue;
          if (result?.isFinal) text += first.transcript;
          else draft += first.transcript;
        }
        if (text.trim()) callbacks.current.onText(text);
        setPreview(draft.trim());
      };
      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        if (event.error === "network") {
          callbacks.current.onError("Speech service unreachable. Check your connection and try again.");
        } else if (event.error === "audio-capture") {
          callbacks.current.onError("No microphone found. Check your device and try again.");
        } else {
          callbacks.current.onError("Microphone blocked. Allow access and try again.");
        }
        stop();
      };
      recognition.onend = () => {
        // Recognition stops itself on long pauses; keep it alive while wanted.
        if (wantListening.current) {
          try {
            recognition.start();
          } catch {
            // Already starting; the next onend retries.
          }
        }
      };
      try {
        recognition.start();
      } catch {
        wantListening.current = false;
        callbacks.current.onError("Dictation could not start. Tap again and allow the microphone.");
        return;
      }
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      wantListening.current = false;
      try {
        recognition?.stop();
      } catch {
        // Never started; nothing to stop.
      }
      callbacks.current.onError("Microphone blocked. Allow access and try again.");
      return;
    }
    if (!wantListening.current) {
      for (const track of stream.getTracks()) track.stop();
      try {
        recognition?.stop();
      } catch {
        // Never started; nothing to stop.
      }
      return;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const state: Running = { stream, context, source, analyser, samples, recognition, frame: 0, smoothed: 0 };
    running.current = state;
    const loop = () => {
      if (running.current !== state) return;
      state.smoothed = Math.max(rms(analyser, samples), state.smoothed * SMOOTHING);
      paint(glowRef.current, state.smoothed);
      state.frame = requestAnimationFrame(loop);
    };
    loop();
    setListening(true);
  }, [stop]);

  const toggle = useCallback(() => {
    if (wantListening.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { listening, preview, toggle, glowRef };
}
