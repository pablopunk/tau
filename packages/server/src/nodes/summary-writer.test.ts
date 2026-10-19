import type { Core, NodeSummary } from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeGateway } from "./gateway";
import { startSummaryWriter, summaryOf } from "./summary-writer";

const json = (value: unknown) => ({
  status: 200,
  headers: {},
  body: Buffer.from(JSON.stringify(value)),
});

const gatewayOf = (): NodeGateway =>
  ({
    isOnline: () => true,
    request: async (_id: string, request: { path: string }) =>
      request.path === "/api/projects"
        ? json([{ id: "p1", name: "Demo", path: "/secret/path" }])
        : json([
            { id: "c1", projectId: "p1", title: "Hello", updatedAt: 5, archivedAt: null, secret: 1 },
            { id: "c2", projectId: "p1", title: "Old", updatedAt: 1, archivedAt: 3 },
          ]),
  }) as unknown as NodeGateway;

afterEach(() => vi.useRealTimers());

describe("node summaries", () => {
  it("keeps titles and times of live threads only", async () => {
    const summary = await summaryOf(gatewayOf(), "m1");
    expect(summary.projects).toEqual([{ id: "p1", name: "Demo" }]);
    expect(summary.threads).toEqual([{ id: "c1", projectId: "p1", title: "Hello", updatedAt: 5 }]);
  });

  it("writes an online node's summary once, then at most every 15 s", async () => {
    vi.useFakeTimers();
    const written: NodeSummary[] = [];
    const core = {
      nodes: {
        list: async () => [{ id: "m1", status: "online" }],
        writeSummary: async (_id: string, summary: NodeSummary) => void written.push(summary),
        heartbeat: () => undefined,
      },
    } as unknown as Core;
    const stop = startSummaryWriter(core, gatewayOf());
    await vi.advanceTimersByTimeAsync(2100);
    expect(written).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(written).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(written).toHaveLength(2);
    stop();
  });
});
