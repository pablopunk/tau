import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { AppError, type VoiceOptions } from "@tau/protocol";

/**
 * Local voice-model files live here, next to the settings store so home
 * migration/reset covers them: `<node-home>/models/parakeet-tdt-0.6b-v3-int8`.
 */
export const PARAKEET_MODEL_DIR_NAME = "parakeet-tdt-0.6b-v3-int8";

export const PARAKEET_MODEL_FILES = [
  "encoder.int8.onnx",
  "decoder.int8.onnx",
  "joiner.int8.onnx",
  "tokens.txt",
] as const;

export const PARAKEET_MODEL_BASE_URL =
  "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main/";

export const modelDirForHome = (homeDir: string): string => join(homeDir, "models", PARAKEET_MODEL_DIR_NAME);

/** Absolute dir of the `sherpa-onnx` npm package. Prefers node resolution
 * (dev checkouts, where the worker file sits next to node_modules); falls
 * back to `<versionDir>/sherpa-onnx` in compiled installs, where `$bunfs`
 * has no node_modules. Returns undefined when neither resolves (the worker
 * then reports unavailable instead of crashing). */
export const sherpaPackageDir = (versionDir: string | undefined): string | undefined => {
  try {
    return dirname(createRequire(import.meta.url).resolve("sherpa-onnx/package.json"));
  } catch {
    return versionDir === undefined ? undefined : join(versionDir, "sherpa-onnx");
  }
};

/** Snapshot shape of `VoiceOptions["local"]`, so `voice-api.ts` options() can return it directly. */
export type LocalVoiceStatus = VoiceOptions["local"];

/** Main -> worker: exactly the transcribe half of the worker protocol. */
export interface TranscribeRequestMessage {
  id: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface TranscriberWorker {
  postMessage(message: TranscribeRequestMessage): void;
  on(event: "message" | "error", listener: (value: unknown) => void): void;
  terminate(): Promise<unknown>;
}

export interface TranscriberOptions {
  readonly modelDir: string;
  /** Absolute dir of the `sherpa-onnx` package (versionDir in compiled
   * installs); undefined resolves via node_modules (dev checkouts). */
  readonly sherpaDir?: string;
  /** Idle RAM hold before unloading; default 5 min. Tests pass milliseconds. */
  readonly idleMs?: number;
  /** Defaults to global fetch; tests inject failures/bytes. */
  readonly fetchImpl?: typeof fetch;
  /** Defaults to a real `worker_thread`; tests inject a fake. */
  readonly createWorker?: (modelDir: string) => TranscriberWorker;
}

const IDLE_UNLOAD_MS = 5 * 60 * 1000;
const WORKER_READY_TIMEOUT_MS = 5 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs the local Parakeet model in a `worker_thread`: single-threaded WASM
 * decode would stall the server loop on long takes. Lifecycle: concurrent
 * `warm()` calls attach to the in-flight one; `transcribe` before ready
 * rejects `invalid_request` (no queueing); idle-unload fires after `idleMs`
 * only when nothing is in flight (the in-flight transcribe count doubles as
 * the refcount — there are no external holders; `close()` is explicit).
 *
 * The `sherpa-onnx` npm import lives only in `transcriber-worker.ts` so the
 * main core bundle never loads the WASM.
 */
export class Transcriber {
  /** Directory of the bundled entry; the worker is `voice-transcriber.js` next to it in dev and embedded in the compiled binary. */
  static workerUrl(): URL {
    return new URL("./transcriber-worker.js", import.meta.url);
  }

  private readonly modelDir: string;
  private readonly sherpaDir: string | undefined;
  private readonly idleMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly createWorker: (modelDir: string) => TranscriberWorker;
  private status: LocalVoiceStatus;
  private worker: TranscriberWorker | undefined;
  private loaded = false;
  private warmPromise: Promise<void> | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (error: unknown) => void }
  >();
  private inFlight = 0;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(options: TranscriberOptions) {
    this.modelDir = options.modelDir;
    this.sherpaDir = options.sherpaDir;
    this.idleMs = options.idleMs ?? IDLE_UNLOAD_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.createWorker =
      options.createWorker ??
      ((modelDir) => {
        const worker = new Worker(Transcriber.workerUrl(), {
          workerData: { modelDir, sherpaDir: this.sherpaDir },
        });
        worker.unref();
        return worker;
      });
    this.status = { available: true, state: "needs-download" };
  }

  /** Current snapshot for `voice.options()`; matches `VoiceOptions["local"]`. */
  getStatus(): LocalVoiceStatus {
    return { ...this.status };
  }

  /**
   * Download the model if needed, then start the worker and load the
   * recognizer into RAM. Serialized: concurrent calls attach to the
   * in-flight warm. Resets the idle-unload timer when already warm.
   */
  async warm(): Promise<void> {
    if (this.loaded) {
      this.scheduleIdleUnload();
      return;
    }
    this.warmPromise ??= this.doWarm().finally(() => {
      this.warmPromise = undefined;
    });
    return this.warmPromise;
  }

  async transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
    if (this.warmPromise !== undefined) {
      throw new AppError(
        "invalid_request",
        "Local voice model is still downloading: warm() is in flight, try again shortly",
      );
    }
    if (!this.loaded || this.worker === undefined) {
      throw new AppError(
        "invalid_request",
        "Local voice model is not ready: call warm() first (the composer warms it on mic press)",
      );
    }
    const id = this.nextId++;
    // In-flight takes hold the worker: no idle-unload can fire mid-take.
    this.clearIdleTimer();
    this.inFlight++;
    try {
      return await new Promise<string>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try {
          this.worker?.postMessage({ id, samples, sampleRate });
        } catch (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    } finally {
      this.pending.delete(id);
      this.inFlight--;
      if (this.loaded) this.scheduleIdleUnload();
    }
  }

  /** Terminate the worker; called on core close and on idle-unload. Safe to call repeatedly. */
  async close(): Promise<void> {
    this.clearIdleTimer();
    this.warmPromise = undefined;
    const worker = this.worker;
    this.worker = undefined;
    this.loaded = false;
    if (worker !== undefined) await worker.terminate().catch(() => undefined);
    for (const { reject } of this.pending.values()) {
      reject(new AppError("internal", "Local voice model closed while transcribing"));
    }
    this.pending.clear();
    this.inFlight = 0;
    this.status = { available: this.status.available, state: "needs-download" };
  }

  /** Delete the downloaded model bytes (explicit; unsetting the default never deletes). */
  async removeModel(): Promise<void> {
    await this.close();
    await rm(this.modelDir, { recursive: true, force: true });
    this.status = { available: this.status.available, state: "needs-download" };
  }

  private async doWarm(): Promise<void> {
    try {
      await this.ensureModelFiles();
    } catch (error) {
      const message = asErrorMessage(error);
      this.status = { available: true, state: "error", error: message };
      throw error instanceof AppError
        ? error
        : new AppError("internal", `Local voice model download failed: ${message}`);
    }
    try {
      await this.startWorker();
    } catch (error) {
      const message = asErrorMessage(error);
      const missingBinding =
        message.includes("sherpa-onnx") && /cannot find|not found|no such/i.test(message);
      this.status = {
        available: !missingBinding,
        state: "error",
        error: message,
      };
      await this.closeWorkerOnly();
      throw error instanceof AppError
        ? error
        : new AppError("internal", `Local voice model failed to load: ${message}`);
    }
    this.loaded = true;
    this.status = { available: true, state: "ready" };
    this.scheduleIdleUnload();
  }

  private async ensureModelFiles(): Promise<void> {
    const missing = PARAKEET_MODEL_FILES.filter((name) => !existsSync(join(this.modelDir, name)));
    if (missing.length === 0) return;
    this.status = { available: true, state: "downloading" };
    await mkdir(this.modelDir, { recursive: true });
    for (const name of missing) await this.downloadFile(name);
  }

  /** Atomic partial-file + rename; existing files are skipped by the caller. */
  private async downloadFile(name: string): Promise<void> {
    const tmp = join(this.modelDir, `${name}.part-${process.pid}`);
    try {
      const response = await this.fetchImpl(`${PARAKEET_MODEL_BASE_URL}${name}`);
      if (!response.ok || response.body === null) {
        throw new Error(`HTTP ${response.status} for ${name}`);
      }
      await pipeline(response.body, createWriteStream(tmp));
      await rename(tmp, join(this.modelDir, name));
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  private startWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const worker = this.createWorker(this.modelDir);
      const timer = setTimeout(() => {
        fail(new Error(`Timed out loading the local voice model after ${WORKER_READY_TIMEOUT_MS}ms`));
      }, WORKER_READY_TIMEOUT_MS);
      timer.unref();
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      worker.on("message", (message: unknown) => {
        if (!isRecord(message)) return;
        if (message["type"] === "ready") {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.worker = worker;
          resolve();
          return;
        }
        if (message["type"] === "load-error" && !settled) {
          fail(
            new Error(
              typeof message["error"] === "string" ? message["error"] : "Voice worker failed to load",
            ),
          );
          return;
        }
        const id = message["id"];
        if (typeof id !== "number") return;
        const entry = this.pending.get(id);
        if (entry === undefined) return;
        if (typeof message["error"] === "string") entry.reject(new AppError("internal", message["error"]));
        else entry.resolve(typeof message["text"] === "string" ? message["text"] : "");
      });
      const onWorkerError = (value: unknown): void => {
        const error = value instanceof Error ? value : new Error(asErrorMessage(value));
        if (!settled) {
          fail(error);
          return;
        }
        // A crashed worker can never serve again: fail the in-flight takes
        // and mark the model unloaded so the next warm() reloads it.
        void this.close().catch(() => undefined);
        for (const { reject: rejectPending } of this.pending.values()) rejectPending(error);
        this.pending.clear();
      };
      // Before ready, a worker error rejects warm(); after ready it fails
      // the in-flight takes and marks the model unloaded (see onWorkerError).
      worker.on("error", onWorkerError);
    });
  }

  private async closeWorkerOnly(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.loaded = false;
    if (worker !== undefined) await worker.terminate().catch(() => undefined);
  }

  private scheduleIdleUnload(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      // Fires only with refcount 0 and no in-flight request.
      if (this.inFlight === 0 && this.warmPromise === undefined && this.loaded) {
        void this.close().catch(() => undefined);
      }
    }, this.idleMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}
