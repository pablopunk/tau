import type { TranscribeInput, VoiceModelSetting } from "@tau/protocol";
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

/**
 * Server-side transcription for the mic toggle. `null`/omitted keeps
 * today's browser SpeechRecognition fallback.
 */
export interface VoiceTranscription {
  readonly setting: Exclude<VoiceModelSetting, null>;
  readonly transcribe: (input: TranscribeInput) => Promise<{ text: string }>;
  /**
   * Best-effort pre-load fired on toggle press so the model loads while the
   * user talks. Unset until the contract gains a warm endpoint.
   */
  readonly warm?: () => Promise<unknown>;
}

export interface Dictation {
  /** True while the microphone is open. */
  readonly listening: boolean;
  /** The current unfinished sentence, for live feedback while talking. */
  readonly preview: string;
  /** Hint when the recognizer repeatedly hears silence. */
  readonly hint: string;
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
  readonly recorder: MediaRecorder | null;
  readonly chunks: Blob[];
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

/** `btoa` over a binary string; chunked so large recordings don't blow the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => bytesToBase64(new Uint8Array(buffer)));
}

/** Explicit little-endian so the PCM bytes never depend on host order. */
function floatsToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setFloat32(i * 4, samples[i] ?? 0, true);
  return bytesToBase64(bytes);
}

/** Opus in WebM where supported, AAC in MP4 for Safari; the server only takes those two. */
function pickRecording(): { mimeType: string } {
  const recorder = window.MediaRecorder;
  if (recorder?.isTypeSupported?.("audio/webm;codecs=opus")) return { mimeType: "audio/webm;codecs=opus" };
  if (recorder?.isTypeSupported?.("audio/webm")) return { mimeType: "audio/webm" };
  if (recorder?.isTypeSupported?.("audio/mp4")) return { mimeType: "audio/mp4" };
  return { mimeType: "" };
}

/**
 * Local flavor decodes client-side (the container never reaches sherpa);
 * provider flavor ships the raw recording.
 */
async function encodeForVoice(blob: Blob, setting: VoiceTranscription["setting"]): Promise<TranscribeInput> {
  if (setting.kind === "provider") {
    return {
      format: "blob",
      mimeType: blob.type.startsWith("audio/mp4") ? "audio/mp4" : "audio/webm",
      data: await blobToBase64(blob),
    };
  }
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return {
      format: "pcm-f32",
      sampleRate: decoded.sampleRate,
      data: floatsToBase64(decoded.getChannelData(0)),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function voiceErrorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : "Could not transcribe the recording.";
}

/**
 * Toggle dictation: opens the mic, streams final transcripts to `onText`,
 * and paints the glow overlay with the live input volume. With a voice
 * setting the toggle records with `MediaRecorder` and transcribes through
 * the thread's node instead of SpeechRecognition; without one it uses the
 * browser recognizer. Transcription is best-effort: without recognition
 * support the toggle still opens the mic and glows, but yields no text.
 */
export function useDictation(
  onText: (text: string) => void,
  onError: (message: string) => void,
  voice?: VoiceTranscription | null,
): Dictation {
  const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState("");
  const [hint, setHint] = useState("");
  const silentStreak = useRef(0);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const running = useRef<Running | null>(null);
  const wantListening = useRef(false);
  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

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
      try {
        current.recorder?.stop();
      } catch {
        // Never started, or finished elsewhere; teardown continues below.
      }
      for (const track of current.stream.getTracks()) track.stop();
      void current.context.close().catch(() => undefined);
    }
    unpaint(glowRef.current);
    setListening(false);
    setPreview("");
  }, []);

  const startGlow = useCallback((stream: MediaStream) => {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    return { context, source, analyser, samples };
  }, []);

  const startRecording = useCallback(async () => {
    wantListening.current = true;
    if (!window.MediaRecorder) {
      wantListening.current = false;
      callbacks.current.onError("This browser can't record audio. Dictation needs Chrome or Safari.");
      return;
    }
    // Best-effort: the model loads while the user talks. Failures surface
    // from `transcribe` below, so a rejected warm never blocks recording.
    void voiceRef.current?.warm?.().catch(() => undefined);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      wantListening.current = false;
      callbacks.current.onError("Microphone blocked. Allow access and try again.");
      return;
    }
    if (!wantListening.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const glow = startGlow(stream);
    const { mimeType } = pickRecording();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const state: Running = { stream, ...glow, recognition: null, recorder, chunks, frame: 0, smoothed: 0 };
    running.current = state;
    const loop = () => {
      if (running.current !== state) return;
      state.smoothed = Math.max(rms(state.analyser, state.samples), state.smoothed * SMOOTHING);
      paint(glowRef.current, state.smoothed);
      state.frame = requestAnimationFrame(loop);
    };
    loop();
    try {
      recorder.start();
    } catch {
      stop();
      callbacks.current.onError("Dictation could not start. Tap again and allow the microphone.");
      return;
    }
    setListening(true);
  }, [startGlow, stop]);

  const finishRecording = useCallback(async () => {
    const current = running.current;
    wantListening.current = false;
    running.current = null;
    if (current) {
      cancelAnimationFrame(current.frame);
      for (const track of current.stream.getTracks()) track.stop();
      void current.context.close().catch(() => undefined);
    }
    unpaint(glowRef.current);
    setListening(false);
    setPreview("");
    const recorder = current?.recorder;
    const chunks = current?.chunks ?? [];
    const transcription = voiceRef.current;
    if (!recorder || !transcription) return;
    try {
      const blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || undefined }));
        recorder.stop();
      });
      const { text } = await transcription.transcribe(await encodeForVoice(blob, transcription.setting));
      if (text.trim()) callbacks.current.onText(text);
    } catch (failure) {
      callbacks.current.onError(voiceErrorMessage(failure));
    }
  }, []);

  const start = useCallback(async () => {
    if (voiceRef.current) {
      await startRecording();
      return;
    }
    wantListening.current = true;
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      wantListening.current = false;
      callbacks.current.onError("Dictation needs Chrome or Safari on this device.");
      return;
    }
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
        if (text.trim() || draft.trim()) {
          silentStreak.current = 0;
          setHint("");
        }
        setPreview(draft.trim());
      };
      recognition.onerror = (event) => {
        if (event.error === "aborted") return;
        if (event.error === "no-speech") {
          // The recognizer hears silence (wrong input device, muted mic,
          // or exclusive hold elsewhere). Say so instead of spinning mute.
          silentStreak.current += 1;
          if (silentStreak.current >= 3) {
            setHint("I can't hear you — check the microphone and try again.");
          }
          return;
        }
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
    const glow = startGlow(stream);
    const state: Running = {
      stream,
      ...glow,
      recognition,
      recorder: null,
      chunks: [],
      frame: 0,
      smoothed: 0,
    };
    running.current = state;
    const loop = () => {
      if (running.current !== state) return;
      state.smoothed = Math.max(rms(state.analyser, state.samples), state.smoothed * SMOOTHING);
      paint(glowRef.current, state.smoothed);
      state.frame = requestAnimationFrame(loop);
    };
    loop();
    setListening(true);
  }, [startGlow, startRecording, stop]);

  const toggle = useCallback(() => {
    if (wantListening.current) {
      if (voiceRef.current) void finishRecording();
      else stop();
    } else {
      silentStreak.current = 0;
      setHint("");
      void start();
    }
  }, [finishRecording, start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { listening, preview, hint, toggle, glowRef };
}
