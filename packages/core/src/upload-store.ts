import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, realpath, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { AppError, type FileRef, MAX_UPLOAD_FILE_BYTES, type UploadInput } from "@tau/protocol";

/** Virtual path root the agent sees; only this store resolves it to disk. */
export const UPLOADS_ROOT_NAME = "uploads/";
/** Staged files live this long; use past it rejects `file_expired`. */
export const STAGED_FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EXTENSION_LENGTH = 12;
/** Only names this store generated are ever swept or resolved. */
const GENERATED_NAME = /^file-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/;
const VIRTUAL_PATH = /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export interface ResolvedUpload {
  readonly ref: FileRef;
  /** The canonical disk path the agent reads the bytes from. */
  readonly absPath: string;
}

export interface UploadStore {
  /** Stages bytes on disk and returns their virtual path. */
  stage(input: UploadInput): Promise<FileRef>;
  /**
   * Rejects `invalid_request` outside the uploads root, `file_expired` for missing, expired or
   * replaced refs. Every message admission calls this before touching the thread.
   */
  resolveRefs(files: readonly FileRef[]): Promise<ResolvedUpload[]>;
}

const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

const expired = (path: string): AppError =>
  new AppError(
    "file_expired",
    `The file "${path}" is no longer available. Stage it again with POST /api/uploads and send the new path.`,
  );

/** Strict canonical base64: alphabet and padding only, decoding to exactly these bytes. */
function decodeStrict(data: string): Buffer {
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) {
    throw new AppError("invalid_request", "The file data is not valid base64.");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) {
    throw new AppError("invalid_request", "The file data is not valid base64.");
  }
  return bytes;
}

const sanitizedExtension = (name: string): string => {
  const ext = extname(name).slice(1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) && ext.length <= MAX_EXTENSION_LENGTH ? ext : "bin";
};

export function createUploadStore(deps: { now?: () => number; root?: string } = {}): UploadStore {
  const now = deps.now ?? Date.now;
  const configured = deps.root ?? process.env.TAU_UPLOADS ?? join(tmpdir(), "tau-uploads");
  let canonicalRoot: Promise<string> | undefined;
  const ensureRoot = (): Promise<string> =>
    (canonicalRoot ??= (async () => {
      await mkdir(configured, { recursive: true, mode: 0o700 });
      return realpath(configured);
    })());

  /** Best effort: drops this store's stale files so the root cannot fill up. */
  async function sweepStale(root: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return;
    }
    const deadline = now() - STAGED_FILE_TTL_MS;
    await Promise.all(
      names
        .filter((name) => GENERATED_NAME.test(name))
        .map(async (name) => {
          try {
            if ((await stat(join(root, name))).mtimeMs < deadline) await unlink(join(root, name));
          } catch {
            // Another writer won the race, or the file is already gone.
          }
        }),
    );
  }

  return {
    async stage(input) {
      const name = input.name;
      if (typeof name !== "string" || name === "" || name !== basename(name) || name.includes("..")) {
        throw new AppError("invalid_request", "The file name must be a bare name without any path.");
      }
      const bytes = decodeStrict(input.data);
      if (bytes.length > MAX_UPLOAD_FILE_BYTES) {
        throw new AppError(
          "too_large",
          `The file is ${mib(bytes.length)}; the limit is ${mib(MAX_UPLOAD_FILE_BYTES)}.`,
        );
      }
      const root = await ensureRoot();
      await sweepStale(root);
      const ext = sanitizedExtension(name);
      for (;;) {
        const id = randomUUID();
        const full = join(root, `file-${id}.${ext}`);
        let handle: Awaited<ReturnType<typeof open>>;
        try {
          handle = await open(full, "wx", 0o600);
        } catch (error) {
          // Two stages racing on one uuid: take another name instead of failing.
          if ((error as NodeJS.ErrnoException)?.code === "EEXIST") continue;
          throw error;
        }
        try {
          await handle.writeFile(bytes);
          await handle.close();
        } catch (error) {
          try {
            await handle.close();
          } catch {
            // The handle is already broken; the unlink below still cleans up.
          }
          await unlink(full).catch(() => undefined);
          throw error;
        }
        // The name is ours alone (`wx` won), so `size` describes exactly these bytes.
        return { name, path: `${UPLOADS_ROOT_NAME}${id}`, size: bytes.length };
      }
    },

    async resolveRefs(files) {
      if (files.length === 0) return [];
      const root = await ensureRoot();
      return Promise.all(
        files.map(async (file) => {
          const id = VIRTUAL_PATH.exec(file.path)?.[1];
          if (!id) {
            throw new AppError("invalid_request", `The file path is outside the uploads root: ${file.path}.`);
          }
          let names: string[];
          try {
            names = await readdir(root);
          } catch {
            throw expired(file.path);
          }
          const name = names.find(
            (candidate) => candidate.startsWith(`file-${id}.`) && GENERATED_NAME.test(candidate),
          );
          if (!name) throw expired(file.path);
          const full = join(root, name);
          let real: string;
          try {
            real = await realpath(full);
          } catch {
            throw expired(file.path);
          }
          // A symlink swapped in after staging must not escape the root.
          if (dirname(real) !== root) {
            throw new AppError("invalid_request", `The file path is outside the uploads root: ${file.path}.`);
          }
          let info: Awaited<ReturnType<typeof stat>>;
          try {
            info = await stat(real);
          } catch {
            throw expired(file.path);
          }
          const stale =
            !info.isFile() || info.size !== file.size || now() - info.mtimeMs > STAGED_FILE_TTL_MS;
          if (stale) {
            await unlink(full).catch(() => undefined);
            throw expired(file.path);
          }
          return { ref: file, absPath: real };
        }),
      );
    },
  };
}
