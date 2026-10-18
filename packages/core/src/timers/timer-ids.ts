import { createHash, randomUUID } from "node:crypto";
import type { Harness } from "@earendil-works/pi-durable";
import type { ChangeEmitter } from "../change-emitter";
import { BACKGROUND } from "../harness/open";
import { HOME_PROJECT_ID } from "../harness/project-store";
import { ProjectsDoc } from "../harness/projects-doc";

/** The same tool call always gets the same id, so a replayed call finds its timer. */
export const timerIdForToolCall = (callId: string) =>
  `t${createHash("sha1").update(callId).digest("hex").slice(0, 7)}`;

export const newTimerId = () => `t${randomUUID().replaceAll("-", "").slice(0, 7)}`;

/** The home project is not in `ProjectsDoc`, but its threads can have timers. */
export const timerProjectIds = (harness: Harness) => async (): Promise<string[]> => [
  HOME_PROJECT_ID,
  ...((await harness.snapshot(ProjectsDoc, BACKGROUND))?.projects ?? []).map((project) => project.id),
];

/** The chip refetches the timers; the sidebar refetches the summaries (count and next run). */
export const announceTimers = (changes: ChangeEmitter) => (projectId: string, conversationId: string) => {
  changes.emit({ resource: "timers", conversationId });
  changes.emit({ resource: "conversations", projectId });
};
