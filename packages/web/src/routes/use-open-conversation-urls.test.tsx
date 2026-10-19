import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useOpenConversation } from "@/activity";
import { conversationPath, newThreadPath, terminalPath } from "@/lib/paths";

const local = { projectId: "p1", conversationId: "c1" };
const remote = { nodeId: "m 1", ...local };

const urls: Array<[string, unknown]> = [
  [conversationPath("p1", "c1"), local],
  [terminalPath("p1", "c1"), local],
  [terminalPath("p1", "c1", "t1"), local],
  [conversationPath("p1", "c1", "m 1"), remote],
  [terminalPath("p1", "c1", undefined, "m 1"), remote],
  [terminalPath("p1", "c1", "t1", "m 1"), remote],
];

function open(url: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(() => useOpenConversation(), { wrapper }).result.current;
}

describe("every consumer of useOpenConversation sees the ids on pane URLs", () => {
  it.each(urls)("%s", (url, expected) => {
    expect(open(url)).toEqual(expected);
  });

  it("reports no nodeId on local URLs and nothing outside a thread", () => {
    expect("nodeId" in open(conversationPath("p1", "c1"))).toBe(false);
    expect(open("/new")).toEqual({});
    expect(open(newThreadPath("p1", "m1"))).toEqual({});
  });
});

describe("URL shapes", () => {
  it("keeps today's local URLs byte for byte and prefixes a node's with /n/<id>", () => {
    expect(conversationPath("p1", "c1")).toBe("/p/p1/c/c1");
    expect(terminalPath("p1", "c1", "t1")).toBe("/p/p1/c/c1/terminal/t1");
    expect(newThreadPath()).toBe("/new");
    expect(newThreadPath("p 1")).toBe("/new?project=p%201");
    expect(conversationPath("p1", "c1", "m1")).toBe("/n/m1/p/p1/c/c1");
    expect(terminalPath("p1", "c1", "t1", "m1")).toBe("/n/m1/p/p1/c/c1/terminal/t1");
    expect(newThreadPath("p1", "m1")).toBe("/new?project=p1&node=m1");
  });
});

describe("sidebar open-project lookup per node", () => {
  it("only matches the URL of its own node", async () => {
    const { projectIdFromPath } = await import("@/sidebar/sidebar-model");
    expect(projectIdFromPath(conversationPath("p1", "c1"))).toBe("p1");
    expect(projectIdFromPath(conversationPath("p1", "c1"), "m 1")).toBeUndefined();
    expect(projectIdFromPath(conversationPath("p1", "c1", "m 1"), "m 1")).toBe("p1");
    expect(projectIdFromPath(terminalPath("p1", "c1", "t1", "m 1"), "m 1")).toBe("p1");
    expect(projectIdFromPath(conversationPath("p1", "c1", "m 1"))).toBeUndefined();
    expect(projectIdFromPath(conversationPath("p1", "c1", "m 1"), "m2")).toBeUndefined();
  });
});
