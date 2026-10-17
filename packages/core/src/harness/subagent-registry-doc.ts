import { defineDoc, type EntryId, type TaskId } from "@earendil-works/pi-durable";

export type ChildRecord = {
  /** Answers already reported to the parent: several messages can end in one answer, reported once. */
  reported: EntryId[];
  stopRequested?: boolean;
};

export type SubagentRegistry = {
  /** tool call id -> child id: a rerun of the same `agent` call finds its child. */
  byCall: Record<string, string>;
  children: Record<string, ChildRecord>;
  reporters: Record<string, TaskId>;
};

export const SubagentRegistryDoc = defineDoc<SubagentRegistry>({
  kind: "app.subagents",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ byCall: {}, children: {}, reporters: {} }),
});
