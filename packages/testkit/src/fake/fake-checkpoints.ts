import { AppError, type Checkpoint, type CheckpointFile, type RestorePreview } from "@pi-everywhere/protocol";
import { FAKE_EDITED_FILE, type MessageEffect } from "./fake-workspace";

interface LoggedRequest {
  readonly requestId: string;
  readonly effect: MessageEffect;
  readonly startedAt: number;
  endedAt: number | null;
}

const EDITED: CheckpointFile = { path: FAKE_EDITED_FILE, added: 1, removed: 0, status: "A" };

export class FakeCheckpoints {
  private requests: LoggedRequest[] = [];

  record(requestId: string, effect: MessageEffect, now: number): void {
    this.requests.push({ requestId, effect, startedAt: now, endedAt: null });
  }

  completeAll(now: number): void {
    for (const request of this.requests) request.endedAt ??= now;
  }

  count(): number {
    return this.requests.length;
  }

  copyFirst(source: FakeCheckpoints, count: number): void {
    this.requests = source.requests
      .slice(0, count)
      .map((request) => ({ ...request, endedAt: request.endedAt ?? request.startedAt }));
  }

  list(userEntryIds: readonly string[]): Checkpoint[] {
    return this.requests.flatMap((request, index) => {
      const entryId = userEntryIds[index] ?? null;
      const before = this.checkpoint(request, entryId, "before", []);
      if (request.endedAt === null) return [before];
      const files = request.effect === "edit" ? [EDITED] : [];
      return [before, this.checkpoint(request, entryId, "after", files)];
    });
  }

  find(checkpointId: string, userEntryIds: readonly string[]): Checkpoint {
    const found = this.list(userEntryIds).find((checkpoint) => checkpoint.id === checkpointId);
    if (!found) throw new AppError("not_found", `Unknown checkpoint: ${checkpointId}`);
    return found;
  }

  preview(entryId: string, userEntryIds: readonly string[]): RestorePreview {
    const checkpoints = this.list(userEntryIds);
    const start = checkpoints.findIndex((item) => item.kind === "before" && item.entryId === entryId);
    const before = checkpoints[start];
    if (!before) throw new AppError("not_found", `No checkpoint for entry: ${entryId}`);
    const later = checkpoints.slice(start).filter((item) => item.kind === "after");
    const files = new Map(later.flatMap((item) => item.files).map((file) => [file.path, file]));
    return {
      checkpointId: before.id,
      changes: [...files.values()].map((file) => ({
        path: file.path,
        action: file.status === "A" ? "delete" : "write",
      })),
    };
  }

  private checkpoint(
    request: LoggedRequest,
    entryId: string | null,
    kind: Checkpoint["kind"],
    files: CheckpointFile[],
  ): Checkpoint {
    const at = kind === "before" ? request.startedAt : (request.endedAt ?? request.startedAt);
    return { id: `${request.requestId}:${kind}`, requestId: request.requestId, entryId, kind, at, files };
  }
}

export function fakeDiffOf(file: CheckpointFile): string {
  return `--- /dev/null\n+++ b/${file.path}\n@@ -0,0 +1 @@\n+hello\n`;
}

export function rejectUnsafePath(path: string): void {
  const unsafe = path.startsWith("/") || path.split("/").includes("..") || path === "";
  if (unsafe) throw new AppError("invalid_request", `Not a repo-relative path: ${path}`);
}
