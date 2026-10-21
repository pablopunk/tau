import {
  AppError,
  MAX_UPLOAD_FILE_BYTES,
  type FileRef,
  type UploadInput,
} from "@tau/protocol";

/** Staged refs live this long; use past it rejects `file_expired`. */
export const FAKE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const UPLOADS_ROOT = "uploads/";

interface StagedUpload {
  readonly mimeType: string;
  readonly stagedAt: number;
}

const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export function createFakeUploads(deps: { now: () => number }) {
  const staged = new Map<string, StagedUpload>();
  let counter = 0;

  const uuidFor = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

  function stage(input: UploadInput): FileRef {
    if (input.name.includes("/") || input.name.includes("\\") || input.name.includes("..")) {
      throw new AppError("invalid_request", "The file name must be a bare name without any path.");
    }
    const size = Buffer.from(input.data, "base64").length;
    if (size > MAX_UPLOAD_FILE_BYTES) {
      throw new AppError(
        "too_large",
        `The file is ${mib(size)}; the limit is ${mib(MAX_UPLOAD_FILE_BYTES)}.`,
      );
    }
    const path = `${UPLOADS_ROOT}${uuidFor(counter++)}`;
    staged.set(path, { mimeType: input.mimeType, stagedAt: deps.now() });
    return { name: input.name, path, size };
  }

  /** Rejects `invalid_request` outside the uploads root, `file_expired` for missing or expired refs. */
  function requireRefs(files: readonly FileRef[]): void {
    for (const file of files) {
      if (!file.path.startsWith(UPLOADS_ROOT) || file.path.includes("..")) {
        throw new AppError("invalid_request", `The file path is outside the uploads root: ${file.path}.`);
      }
      const entry = staged.get(file.path);
      if (!entry || deps.now() - entry.stagedAt > FAKE_UPLOAD_TTL_MS) {
        staged.delete(file.path);
        throw new AppError(
          "file_expired",
          `The file "${file.path}" is no longer available. Stage it again with POST /api/uploads and send the new path.`,
        );
      }
    }
  }

  return { stage, requireRefs };
}
