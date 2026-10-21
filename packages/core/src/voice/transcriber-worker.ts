import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

// sherpa-onnx ships no TypeScript types; the structural types below pin the
// exact surface this worker uses. It is loaded dynamically (never bundled):
// the Emscripten glue only initializes when required as real files, and
// `neverBundle` in tsdown keeps this import out of the bundle.

/**
 * Worker-thread entry for local transcription (shipped as its own bundle
 * entry so `new Worker()` finds it in dev and embedded in the compiled
 * binary). This is the ONLY file that imports the `sherpa-onnx` WASM
 * binding — keep that import here so the main core bundle never loads it.
 *
 * Model paths cross via workerData (plain disk paths, no bundling issues).
 * Protocol: warm/load happens at startup (`{type:"ready"}` or
 * `{type:"load-error",error}`), then `{id, samples, sampleRate}` ->
 * `{id, text}` | `{id, error}`. Mirror of the Transcriber protocol in
 * `transcriber.ts`: keep in sync.
 */

interface OfflineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
}

interface OfflineRecognizer {
  createStream(): OfflineStream;
  decode(stream: OfflineStream): void;
  getResult(stream: OfflineStream): { text: string };
  free(): void;
}

interface TranscriberWorkerData {
  modelDir: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const data = workerData as TranscriberWorkerData & { sherpaDir?: string };

type CreateOfflineRecognizer = (config: unknown) => OfflineRecognizer;

let recognizer: OfflineRecognizer | undefined;
// Always an absolute file URL: the bundler never sees this specifier, so
// the Emscripten glue loads as real files in dev and compiled installs alike.
if (!data.sherpaDir) {
  parentPort?.postMessage({ type: "load-error", error: "Speech engine is not installed." });
} else {
  try {
    const sherpa = (await import(pathToFileURL(join(data.sherpaDir, "index.js")).href)) as unknown as {
      createOfflineRecognizer?: CreateOfflineRecognizer;
      default?: { createOfflineRecognizer: CreateOfflineRecognizer };
    };
    const createRecognizer = sherpa.createOfflineRecognizer ?? sherpa.default?.createOfflineRecognizer;
    if (!createRecognizer) throw new Error("Speech engine failed to load.");
    recognizer = createRecognizer({
      // Mirror of webr's worker: 16kHz features, 80 dims, single-threaded WASM
      // decode (numThreads clamps to 1 in WASM — pass 1).
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        // NeMo transducer (int8 Parakeet): encoder/decoder/joiner + tokens.
        transducer: {
          encoder: join(data.modelDir, "encoder.int8.onnx"),
          decoder: join(data.modelDir, "decoder.int8.onnx"),
          joiner: join(data.modelDir, "joiner.int8.onnx"),
        },
        tokens: join(data.modelDir, "tokens.txt"),
        numThreads: 1,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
    });
    parentPort?.postMessage({ type: "ready" });
  } catch (error) {
    parentPort?.postMessage({ type: "load-error", error: messageOf(error) });
  }
}

parentPort?.on("message", (message: unknown) => {
  const request = message as { id: unknown; samples: unknown; sampleRate: unknown };
  if (typeof request?.id !== "number" || !(request.samples instanceof Float32Array)) return;
  if (typeof request.sampleRate !== "number") {
    parentPort?.postMessage({ id: request.id, error: "sampleRate must be a number" });
    return;
  }
  if (recognizer === undefined) {
    parentPort?.postMessage({ id: request.id, error: "Local voice model failed to load" });
    return;
  }
  const stream = recognizer.createStream();
  try {
    // sherpa resamples internally, so the client uploads decoded PCM at its native rate.
    stream.acceptWaveform(request.sampleRate, request.samples);
    recognizer.decode(stream);
    parentPort?.postMessage({ id: request.id, text: recognizer.getResult(stream).text });
  } catch (error) {
    parentPort?.postMessage({ id: request.id, error: messageOf(error) });
  } finally {
    stream.free();
  }
});
