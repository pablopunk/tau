import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { conversation, renderAt } from "../test-support";
import { SubagentBanner } from "./SubagentBanner";
import { SubagentTypeLabel } from "./SubagentTypeLabel";

const reviewer = conversation({
  id: "2",
  parentId: "1",
  agentType: "reviewer",
  agentModel: { provider: "x", modelId: "m-1" },
  agentStatus: "running",
});
const rerunAfterStop = conversation({ id: "3", parentId: "1", agentStatus: "stopped", status: "running" });
const all = [conversation({ id: "1", title: "Parent" }), reviewer, rerunAfterStop];

vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useAllConversations: () => ({ data: all }),
}));

describe("subagent header and sidebar label", () => {
  it("shows type, model, status and Stop in the child header", () => {
    renderAt("/", <SubagentBanner parentId="1" childId="2" />);
    expect(screen.getByText(/reviewer/)).toBeTruthy();
    expect(screen.getByText(/m-1/)).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("offers Stop while the child runs again after an earlier stop", () => {
    renderAt("/", <SubagentBanner parentId="1" childId="3" />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("labels special types only", () => {
    const special = renderAt("/", <SubagentTypeLabel conversation={reviewer} />);
    expect(special.container.querySelector("[data-slot=subagent-type]")?.textContent).toBe("reviewer");
    const plain = renderAt(
      "/",
      <SubagentTypeLabel conversation={{ ...reviewer, agentType: "general-purpose" }} />,
    );
    expect(plain.container.querySelector("[data-slot=subagent-type]")).toBeNull();
  });
});
