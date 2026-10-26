import { mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestTodos, viewToText } from "@tau/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParityHarness, parityUserEntries, parityView } from "./product-parity-support";

const lease = join(
  process.platform === "darwin" ? "/private/tmp" : tmpdir(),
  "tau-product-recovery-heavy-15158add-7047a353.lock",
);
let ownsLease = false;
let h: Awaited<ReturnType<typeof createParityHarness>>;

beforeAll(async () => {
  for (;;) {
    try {
      await mkdir(lease);
      ownsLease = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  h = await createParityHarness();
}, 300_000);
afterAll(async () => {
  try {
    await h?.close();
  } finally {
    if (ownsLease) await rmdir(lease);
  }
});

describe("actual source CLI → HTTP → seeded fake Core state (not SDK proof)", () => {
  it("C.send-B: admits once on B/7, leaves colliding A/7 unchanged, reads via B stream", async () => {
    const beforeA = viewToText(await parityView(h.a, "7"));
    const args = [
      "threads",
      "send",
      "7",
      "C-unique-followup",
      "--request-id",
      "C.send-B",
      "--node",
      h.nodeB,
      "--machine",
    ];
    const first = await h.cli(args);
    expect(first.exit, first.stderr).toBe(0);
    expect(first.frames).toHaveLength(1);
    expect(first.frames[0]).toMatchObject({
      kind: "receipt",
      nodeId: h.nodeB,
      threadId: "7",
      requestId: "C.send-B",
      observation: "response",
      lifecycle: null,
    });
    await expect
      .poll(async () => parityUserEntries(await parityView(h.b, "7"), "C-unique-followup").length)
      .toBe(1);
    const admitted = parityUserEntries(await parityView(h.b, "7"), "C-unique-followup");
    expect(new Set(admitted.map((entry) => entry.id)).size).toBe(1);
    expect(typeof first.frames[0].submissionId).toBe("number");
    const retry = await h.cli(args);
    expect(retry.exit, retry.stderr).toBe(0);
    expect(retry.frames[0].submissionId).toBe(first.frames[0].submissionId);
    expect(viewToText(await parityView(h.a, "7"))).toBe(beforeA);
    const persisted = parityUserEntries(await parityView(h.b, "7"), "C-unique-followup");
    expect(persisted).toHaveLength(1);
    expect(persisted.map((entry) => entry.id)).toEqual(admitted.map((entry) => entry.id));
    const read = await h.cli(["threads", "read", "7", "--node", h.nodeB, "--machine"]);
    expect(read.exit, read.stderr).toBe(0);
    expect(read.frames[0]).toMatchObject({ nodeId: h.nodeB, threadId: "7", kind: "terminal" });
    expect(read.frames[0].result).toContain("C-unique-followup");
  }, 60_000);
  it("C.project-add: same public request and persisted result; confirmation gates delete", async () => {
    const added = await h.cli(["projects", "add", "/synthetic", "--name", "C project", "--machine"]);
    expect(added.exit, added.stderr).toBe(0);
    const id = added.frames[0].result.id;
    expect((await h.a.projects.list()).find((project) => project.id === id)?.name).toBe("C project");
    const denied = await h.cli(["projects", "remove", id, "--machine"]);
    expect(denied.exit).toBe(2);
    expect(denied.frames[0].error.code).toBe("usage");
    expect((await h.a.projects.list()).some((project) => project.id === id)).toBe(true);
    expect((await h.cli(["projects", "remove", id, "--yes", "--machine"])).exit).toBe(0);
    expect((await h.a.projects.list()).some((project) => project.id === id)).toBe(false);
  }, 60_000);
  it("C.todos: records the user edit on B without editing A", async () => {
    const beforeA = latestTodos(await parityView(h.a, "7"));
    const input = { requestId: "C.todos", todos: [{ content: "C task", status: "pending" }] };
    const result = await h.cli([
      "threads",
      "todos",
      "7",
      "--json",
      JSON.stringify(input),
      "--node",
      h.nodeB,
      "--machine",
    ]);
    expect(result.exit, result.stderr).toBe(0);
    expect(latestTodos(await parityView(h.a, "7"))).toEqual(beforeA);
    expect(JSON.stringify(latestTodos(await parityView(h.b, "7")))).toContain("C task");
  }, 60_000);
  it("C.native-unsupported: fake runtime refusal is not SDK compatibility", async () => {
    const before = (await h.b.conversations.listAll()).length;
    const result = await h.cli([
      "threads",
      "start",
      "go",
      "--project",
      "home",
      "--executor",
      "claude-code",
      "--node",
      h.nodeB,
      "--machine",
    ]);
    expect(result.exit).toBe(1);
    expect(result.frames[0]).toMatchObject({
      kind: "error",
      error: { source: "protocol", code: "invalid_request" },
    });
    expect((await h.b.conversations.listAll()).length).toBe(before);
  }, 60_000);
  it("C.disconnected-B: failed B mutation cannot touch A", async () => {
    const beforeA = viewToText(await parityView(h.a, "7"));
    const beforeB = viewToText(await parityView(h.b, "7"));
    h.disconnect();
    const result = await h.cli(["threads", "send", "7", "C-must-not-arrive", "--node", h.nodeB, "--machine"]);
    expect(result.exit).toBe(1);
    expect(result.frames[0]).toMatchObject({ nodeId: h.nodeB, threadId: "7", kind: "error" });
    expect(viewToText(await parityView(h.a, "7"))).toBe(beforeA);
    expect(viewToText(await parityView(h.b, "7"))).toBe(beforeB);
  }, 60_000);
});
