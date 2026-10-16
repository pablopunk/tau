import type { Harness } from "@earendil-works/pi-durable";
import type { ChangeEmitter } from "../change-emitter";

export interface StatusTrackerDeps {
  readonly changes: ChangeEmitter;
  readonly now: () => number;
}

export interface StatusTracker {
  /** Called from `beforeResume`: subscribes to commits before the Harness resumes. */
  attach(harness: Harness): void;
  /** Recomputes the status of entries stored as running. */
  recoverAtStartup(): Promise<void>;
}

export function createStatusTracker(_deps: StatusTrackerDeps): StatusTracker {
  return {
    attach() {},
    async recoverAtStartup() {},
  };
}
