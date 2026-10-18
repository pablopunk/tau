import type { ModelInfo, Project } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import {
  clampThinkingLevel,
  pickModel,
  pickProjectId,
  pickThinkingLevel,
  projectsHomeFirst,
} from "./new-thread-defaults";

const model = (modelId: string, thinkingLevels: ModelInfo["thinkingLevels"]): ModelInfo =>
  ({ provider: "p", modelId, name: modelId, images: true, thinkingLevels }) as ModelInfo;

const project = (id: string, kind: Project["kind"], status: Project["status"] = "ready"): Project =>
  ({ id, name: id, path: `/${id}`, createdAt: 0, kind, status }) as Project;

describe("thinking level", () => {
  it("defaults to medium, clamped to what the model supports", () => {
    expect(pickThinkingLevel(model("a", ["off", "low", "high"]), null)).toBe("low");
    expect(pickThinkingLevel(model("a", ["off", "low", "medium"]), null)).toBe("medium");
  });

  it("is off for models without reasoning", () => {
    expect(pickThinkingLevel(model("a", ["off"]), "high")).toBe("off");
    expect(clampThinkingLevel("medium", ["minimal", "max"])).toBe("minimal");
  });
});

describe("model", () => {
  const models = [model("a", ["off"]), model("b", ["off"])];

  it("prefers the last choice, then the default, then the first", () => {
    expect(pickModel(models, { provider: "p", modelId: "b" }, null)?.modelId).toBe("b");
    expect(
      pickModel(models, { provider: "p", modelId: "gone" }, { provider: "p", modelId: "b" })?.modelId,
    ).toBe("b");
    expect(pickModel(models, null, null)?.modelId).toBe("a");
  });
});

describe("project", () => {
  const projects = [
    project("x", "folder"),
    project("h", "home"),
    project("c", "git", "cloning"),
    project("f", "git", "failed"),
  ];

  it("falls back to Home when the wanted project is gone or failed", () => {
    expect(pickProjectId(projects, "x")).toBe("x");
    expect(pickProjectId(projects, "gone")).toBe("h");
    expect(pickProjectId(projects, "f")).toBe("h");
    expect(pickProjectId(projects, null)).toBe("h");
  });

  it("keeps a chosen cloning project instead of falling back to Home", () => {
    expect(pickProjectId(projects, "c")).toBe("c");
  });

  it("lists Home first", () => {
    expect(projectsHomeFirst(projects)[0]?.id).toBe("h");
  });
});
