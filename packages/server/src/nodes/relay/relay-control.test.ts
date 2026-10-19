import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Chain, startChain } from "./test-chain";

let chain: Chain;
beforeEach(async () => {
  chain = await startChain();
});
afterEach(() => chain.stop());

describe("announce and expel-sync dispatch", () => {
  it("sends the expel set before the first announce on every link-up", async () => {
    const { a, b } = chain;
    await vi.waitFor(() => expect(b.control.heard.some((entry) => entry.startsWith("announce:"))).toBe(true));
    const fromA = b.control.heard.filter((entry) => entry.includes(a.nodeId));
    expect(fromA[0]).toBe(`sync:${a.nodeId}`);
    expect(fromA[1]).toMatch(/^announce:/);
  });

  it("re-floods an accepted announce to every link but the source, with the ttl core gave", async () => {
    const { a, c } = chain;
    a.control.topology();
    c.control.topology();
    await vi.waitFor(() => expect(c.control.heard).toContain(`announce:${chain.b.nodeId}:3`));
    await vi.waitFor(() => expect(a.control.heard).toContain(`announce:${chain.b.nodeId}:3`));
    expect(a.control.heard.some((entry) => entry === `announce:${a.nodeId}:3`)).toBe(false);
  });
});
