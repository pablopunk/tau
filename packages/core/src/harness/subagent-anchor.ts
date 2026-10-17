import { defineTask } from "@earendil-works/pi-durable";

/** Owns a child conversation; background, so the parent's abort and idle waits stop at it. Completes at once. */
export const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "app.subagent-anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_anchor, runtime, taskContext) =>
      runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        taskContext,
      ),
  },
  abort: (_anchor, runtime, taskContext) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext),
});
