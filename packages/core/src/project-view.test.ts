import type { Project } from "@pi-everywhere/protocol";
import { describe, expect, it } from "vitest";
import { createPresentProject } from "./project-view";

const project = (status: Project["status"]): Project => ({
  id: "p1",
  name: "p",
  path: "/p",
  createdAt: 0,
  kind: "folder",
  status,
});

describe("createPresentProject", () => {
  const present = createPresentProject({ version: async () => "auto" } as never);

  it("serves an icon url only once the project is ready", async () => {
    expect((await present(project("cloning"))).iconUrl).toBeNull();
    expect((await present(project("failed"))).iconUrl).toBeNull();
    expect((await present(project("ready"))).iconUrl).toContain("/p1/icon");
  });
});
