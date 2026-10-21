import { parentPort } from "node:worker_threads";

/**
 * Worker-thread entry for local transcription (shipped as its own bundle entry
 * so `new Worker()` finds it in dev and embedded in the compiled binary).
 * Agent (a) fills this: import the `sherpa-onnx` WASM binding here (keep that
 * import inside this entry only, so the main bundle never loads the WASM),
 * receive model paths via `workerData`, handle warm/transcribe/close messages.
 */
parentPort?.on("message", (message: unknown) => {
  void message;
  // TODO(agent a): warm/transcribe/close protocol against the sherpa OfflineRecognizer.
  parentPort?.postMessage({ ok: false, error: "Not implemented: transcriber worker" });
});
