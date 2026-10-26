import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import {
  modelDirForHome,
  PARAKEET_MODEL_BASE_URL,
  PARAKEET_MODEL_FILES,
  type TranscribeRequestMessage,
  Transcriber,
  type TranscriberWorker,
} from "./transcriber";

const tempDir = useTempDir();

/** Controllable fake for the worker_thread: silent until the test drives it. */
function createFakeWorkerFactory() {
  const workers: {
    modelDir: string;
    posted: TranscribeRequestMessage[];
    listeners: Map<string, ((value: unknown) => void)[]>;
    terminated: boolean;
    emit: (message: unknown) => void;
    fail: (error: unknown) => void;
  }[] = [];
  const createWorker = (modelDir: string): TranscriberWorker => {
    const worker = {
      modelDir,
      posted: [] as TranscribeRequestMessage[],
      listeners: new Map<string, ((value: unknown) => void)[]>(),
      terminated: false,
      emit(message: unknown) {
        for (const listener of this.listeners.get("message") ?? []) listener(message);
      },
      fail(error: unknown) {
        for (const listener of this.listeners.get("error") ?? []) listener(error);
      },
    };
    workers.push(worker);
    return {
      postMessage: (message: TranscribeRequestMessage) => {
        worker.posted.push(message);
      },
      on: (event: "message" | "error", listener: (value: unknown) => void) => {
        const list = worker.listeners.get(event) ?? [];
        list.push(listener);
        worker.listeners.set(event, list);
      },
      terminate: async () => {
        worker.terminated = true;
      },
    };
  };
  return { workers, createWorker };
}

const okFetch = (bytes: Uint8Array = new Uint8Array([1, 2, 3])): typeof fetch =>
  (async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  })) as unknown as typeof fetch;

const failingFetch = (status = 404): typeof fetch =>
  (async () => ({ ok: false, status, body: null })) as unknown as typeof fetch;

const readyWorker = (factory: ReturnType<typeof createFakeWorkerFactory>, index = 0): void => {
  const worker = factory.workers[index];
  if (worker === undefined) throw new Error("test: worker was not created");
  worker.emit({ type: "ready" });
};

const waitFor = async (condition: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`test timeout waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const warmWithFakeWorker = async (
  factory: ReturnType<typeof createFakeWorkerFactory>,
  warming: Promise<void>,
): Promise<void> => {
  await waitFor(() => factory.workers.length > 0, "worker creation");
  readyWorker(factory);
  await warming;
};

describe("Transcriber", () => {
  it("reports needs-download before the first warm", async () => {
    const root = await tempDir();
    const transcriber = new Transcriber({ modelDir: join(root, "models", "parakeet") });
    expect(transcriber.getStatus()).toEqual({ available: true, state: "needs-download" });
    await transcriber.close();
  });

  it("transcribe before warm rejects invalid_request (no queueing)", async () => {
    const root = await tempDir();
    const transcriber = new Transcriber({ modelDir: join(root, "m") });
    const error = await transcriber.transcribe(new Float32Array([0]), 16000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("invalid_request");
    await transcriber.close();
  });

  it("warms: downloads missing files atomically, skips existing, then loads", async () => {
    const root = await tempDir();
    const modelDir = join(root, "models", "parakeet-tdt-0.6b-v3-int8");
    const { workers, createWorker } = createFakeWorkerFactory();
    const fetchImpl = vi.fn(okFetch());
    const transcriber = new Transcriber({ modelDir, fetchImpl, createWorker });

    // One file already on disk is skipped.
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(modelDir, "tokens.txt"), "existing");
    const warming = transcriber.warm();
    // Downloading state is observable while in flight.
    expect(["downloading", "ready"]).toContain(transcriber.getStatus().state);
    await warmWithFakeWorker({ workers, createWorker }, warming);

    expect(transcriber.getStatus()).toEqual({ available: true, state: "ready" });
    expect(fetchImpl).toHaveBeenCalledTimes(PARAKEET_MODEL_FILES.length - 1);
    for (const name of PARAKEET_MODEL_FILES) {
      if (name === "tokens.txt") {
        expect(fetchImpl).not.toHaveBeenCalledWith(`${PARAKEET_MODEL_BASE_URL}${name}`);
      } else {
        expect(fetchImpl).toHaveBeenCalledWith(`${PARAKEET_MODEL_BASE_URL}${name}`);
      }
    }
    // Untouched existing file keeps its bytes; no leftovers.
    expect(await readFile(join(modelDir, "tokens.txt"), "utf8")).toBe("existing");
    const entries = await readdir(modelDir);
    expect(entries.filter((name) => name.includes(".part"))).toEqual([]);
    expect(entries).toHaveLength(PARAKEET_MODEL_FILES.length);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.modelDir).toBe(modelDir);
    await transcriber.close();
  });

  it("reports byte progress while downloading", async () => {
    const root = await tempDir();
    const modelDir = join(root, "m");
    const { workers, createWorker } = createFakeWorkerFactory();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let first = true;
    const closedFetch = (size: number) => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(size) }),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(size));
          c.close();
        },
      }),
    });
    const fetchImpl = vi.fn((async () => {
      if (first) {
        first = false;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": "10" }),
          body: new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
            },
          }),
        };
      }
      return closedFetch(4);
    }) as unknown as typeof fetch);
    const transcriber = new Transcriber({ modelDir, fetchImpl, createWorker });
    const warming = transcriber.warm();
    await waitFor(() => transcriber.getStatus().state === "downloading", "downloading state");
    await waitFor(() => controller !== undefined, "download stream");
    controller.enqueue(new Uint8Array([1, 2, 3, 4]));
    await waitFor(
      () =>
        JSON.stringify(transcriber.getStatus().progress) ===
        JSON.stringify({ file: PARAKEET_MODEL_FILES[0], downloaded: 4, total: 10 }),
      "download progress",
    );
    controller.close();
    await warmWithFakeWorker({ workers, createWorker }, warming);
    expect(transcriber.getStatus()).toEqual({ available: true, state: "ready" });
    await transcriber.close();
  });

  it("serializes concurrent warms onto one download + one worker", async () => {
    const root = await tempDir();
    const modelDir = join(root, "m");
    const { workers, createWorker } = createFakeWorkerFactory();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      await gate;
      return okFetch()(...args);
    });
    const transcriber = new Transcriber({ modelDir, fetchImpl, createWorker });
    const first = transcriber.warm();
    const second = transcriber.warm();
    expect(transcriber.getStatus().state).toBe("downloading");
    release();
    // Let the downloads finish and the worker start before signalling ready.
    await waitFor(() => workers.length > 0, "worker creation");
    readyWorker({ workers, createWorker });
    await Promise.all([first, second]);
    expect(workers).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(PARAKEET_MODEL_FILES.length);
    expect(transcriber.getStatus().state).toBe("ready");
    await transcriber.close();
  });

  it("download failure surfaces error state with the message", async () => {
    const root = await tempDir();
    const transcriber = new Transcriber({ modelDir: join(root, "m"), fetchImpl: failingFetch(404) });
    const error = await transcriber.warm().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    const status = transcriber.getStatus();
    expect(status.state).toBe("error");
    expect(status.error).toContain("404");
    expect(status.error).toContain("encoder.int8.onnx");
    await transcriber.close();
  });

  it("worker load failure surfaces error state", async () => {
    const root = await tempDir();
    const { workers, createWorker } = createFakeWorkerFactory();
    const transcriber = new Transcriber({ modelDir: join(root, "m"), fetchImpl: okFetch(), createWorker });
    const warming = transcriber.warm();
    await waitFor(() => workers.length > 0, "worker creation");
    workers[0]?.emit({ type: "load-error", error: "no such file: encoder" });
    const error = await warming.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    const status = transcriber.getStatus();
    expect(status.state).toBe("error");
    expect(status.error).toContain("no such file");
    await transcriber.close();
  });

  it("transcribe posts PCM to the worker and resolves the text", async () => {
    const root = await tempDir();
    const { workers, createWorker } = createFakeWorkerFactory();
    const transcriber = new Transcriber({ modelDir: join(root, "m"), fetchImpl: okFetch(), createWorker });
    const warming = transcriber.warm();
    await warmWithFakeWorker({ workers, createWorker }, warming);

    const samples = new Float32Array([0.1, -0.2, 0.3]);
    const pending = transcriber.transcribe(samples, 44100);
    await waitFor(() => (workers[0]?.posted.length ?? 0) > 0, "transcribe post");
    expect(workers[0]?.posted).toHaveLength(1);
    expect(workers[0]?.posted[0]?.sampleRate).toBe(44100);
    expect(workers[0]?.posted[0]?.samples).toBe(samples);
    workers[0]?.emit({ id: workers[0]?.posted[0]?.id, text: "hello world" });
    await expect(pending).resolves.toBe("hello world");
    await transcriber.close();
  });

  it("transcribe rejects while a warm (download) is in flight", async () => {
    const root = await tempDir();
    const { workers, createWorker } = createFakeWorkerFactory();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      await gate;
      return okFetch()(...args);
    }) as typeof fetch;
    const transcriber = new Transcriber({ modelDir: join(root, "m"), fetchImpl, createWorker });
    const warming = transcriber.warm();
    const error = await transcriber.transcribe(new Float32Array([0]), 16000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("invalid_request");
    release();
    await warmWithFakeWorker({ workers, createWorker }, warming);
    await transcriber.close();
  });

  it("worker error replies reject transcribe with internal", async () => {
    const root = await tempDir();
    const { workers, createWorker } = createFakeWorkerFactory();
    const transcriber = new Transcriber({ modelDir: join(root, "m"), fetchImpl: okFetch(), createWorker });
    const warming = transcriber.warm();
    await warmWithFakeWorker({ workers, createWorker }, warming);
    const pending = transcriber.transcribe(new Float32Array([0]), 16000);
    await waitFor(() => (workers[0]?.posted.length ?? 0) > 0, "transcribe post");
    workers[0]?.emit({ id: workers[0]?.posted[0]?.id, error: "decode blew up" });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("internal");
    await transcriber.close();
  });

  it("idle-unloads after idleMs with refcount 0, and a take holds it", async () => {
    const root = await tempDir();
    const { workers, createWorker } = createFakeWorkerFactory();
    const transcriber = new Transcriber({
      modelDir: join(root, "m"),
      fetchImpl: okFetch(),
      createWorker,
      idleMs: 20,
    });
    const warming = transcriber.warm();
    await warmWithFakeWorker({ workers, createWorker }, warming);

    // A take in flight blocks the unload.
    const pending = transcriber.transcribe(new Float32Array([0]), 16000);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(workers[0]?.terminated).toBe(false);
    workers[0]?.emit({ id: workers[0]?.posted[0]?.id, text: "done" });
    await pending;

    // Then idleness unloads: worker terminated, transcribe rejects again.
    await waitFor(() => workers[0]?.terminated === true, "idle unload");
    expect(transcriber.getStatus().state).toBe("needs-download");
    const error = await transcriber.transcribe(new Float32Array([0]), 16000).catch((e: unknown) => e);
    expect((error as AppError).code).toBe("invalid_request");
    await transcriber.close();
  });

  it("removeModel deletes the bytes and resets the state", async () => {
    const root = await tempDir();
    const modelDir = join(root, "m");
    const { workers, createWorker } = createFakeWorkerFactory();
    const transcriber = new Transcriber({ modelDir, fetchImpl: okFetch(), createWorker });
    const warming = transcriber.warm();
    await warmWithFakeWorker({ workers, createWorker }, warming);
    expect(transcriber.getStatus().state).toBe("ready");
    await transcriber.removeModel();
    await expect(stat(modelDir)).rejects.toThrow();
    expect(transcriber.getStatus()).toEqual({ available: true, state: "needs-download" });
    expect(workers[0]?.terminated).toBe(true);
  });

  it("a crashed worker fails in-flight takes and unloads", async () => {
    const root = await tempDir();
    const { workers, createWorker } = createFakeWorkerFactory();
    const transcriber = new Transcriber({ modelDir: join(root, "m"), fetchImpl: okFetch(), createWorker });
    const warming = transcriber.warm();
    await warmWithFakeWorker({ workers, createWorker }, warming);
    const pending = transcriber.transcribe(new Float32Array([0]), 16000);
    workers[0]?.fail(new Error("worker crashed"));
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(transcriber.getStatus().state).toBe("needs-download");
    await transcriber.close();
  });

  it("modelDirForHome nests under <home>/models", () => {
    expect(modelDirForHome("/data/home")).toBe(join("/data/home", "models", "parakeet-tdt-0.6b-v3-int8"));
  });
});
