import { MAX_IMAGES_PER_MESSAGE, MAX_UPLOAD_FILE_BYTES, type FileRef } from "@tau/protocol";

export interface FileAttachment {
  id: number;
  ref: FileRef;
}

const PREFIX = "tau:file-attachments:";
const byTarget = new Map<string, FileAttachment[]>();
let nextId = 1;

const keyOf = (target: string): string => PREFIX + target;

/** Only refs cross the wire: a staged file is a bare name, a virtual path and a size, never bytes. */
function isFileRef(value: unknown): value is FileRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.name === "string" &&
    ref.name.length >= 1 &&
    ref.name.length <= 255 &&
    typeof ref.path === "string" &&
    ref.path.length >= 1 &&
    ref.path.length <= 1024 &&
    Number.isInteger(ref.size) &&
    (ref.size as number) >= 0 &&
    (ref.size as number) <= MAX_UPLOAD_FILE_BYTES
  );
}

function readStored(target: string): FileAttachment[] | null {
  try {
    const raw = window.localStorage.getItem(keyOf(target));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isFileRef)) {
      window.localStorage.removeItem(keyOf(target));
      return null;
    }
    return parsed.map((ref) => newFileAttachment(ref));
  } catch {
    return null;
  }
}

function writeStored(target: string, files: FileAttachment[]): void {
  try {
    if (files.length === 0) window.localStorage.removeItem(keyOf(target));
    else window.localStorage.setItem(keyOf(target), JSON.stringify(files.map((item) => item.ref)));
  } catch {
    // Storage unavailable or quota exceeded: keep the in-memory copy so the current session still works.
  }
}

export function loadFileAttachments(target: string): FileAttachment[] {
  const cached = byTarget.get(target);
  if (cached) return cached;
  const stored = readStored(target);
  if (stored) byTarget.set(target, stored);
  return byTarget.get(target) ?? [];
}

export function saveFileAttachments(target: string, files: FileAttachment[]): void {
  if (files.length === 0) byTarget.delete(target);
  else byTarget.set(target, files);
  writeStored(target, files);
}

export function newFileAttachment(ref: FileRef): FileAttachment {
  return { id: nextId++, ref };
}

export function fileRoomLeft(files: readonly FileAttachment[]): number {
  return MAX_IMAGES_PER_MESSAGE - files.length;
}

const UNITS = ["B", "KB", "MB"] as const;

export function formatFileSize(size: number): string {
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1);
  return `${rounded} ${UNITS[unit]}`;
}
