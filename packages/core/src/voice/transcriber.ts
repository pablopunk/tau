/**
 * Runs the local Parakeet model in a `worker_thread`: single-threaded WASM
 * decode would stall the server loop on long takes. Agent (a) fills this by
 * porting webr's strategy onto WASM: `warm()` downloads the int8 model into
 * `<node-home>/models/parakeet-tdt-0.6b-v3-int8` if needed, starts the worker
 * (see `transcriber-worker.ts`), loads the recognizer into RAM; `transcribe`
 * sends PCM and awaits the text; idle-unload fires after 5 min with refcount 0
 * and no in-flight request. Lifecycle: concurrent `warm()` calls attach to the
 * in-flight one; `transcribe` before ready rejects a named AppError the
 * composer maps to a hint (no queueing).
 */
export class Transcriber {
  /** Directory of the bundled entry; the worker is `voice-transcriber.js` next to it in dev and embedded in the compiled binary. */
  static workerUrl(): URL {
    return new URL("./transcriber-worker.js", import.meta.url);
  }

  async warm(): Promise<void> {
    // TODO(agent a): download-if-missing → start worker → load recognizer; serialize concurrent warms.
    throw new Error("Not implemented: Transcriber.warm");
  }

  async transcribe(_samples: Float32Array, _sampleRate: number): Promise<string> {
    // TODO(agent a): post PCM to the worker and await the text.
    throw new Error("Not implemented: Transcriber.transcribe");
  }

  async close(): Promise<void> {
    // TODO(agent a): terminate the worker; called on core close and idle-unload.
  }
}
