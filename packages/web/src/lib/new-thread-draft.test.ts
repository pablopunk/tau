import { describe, expect, it } from "vitest";
import { clearNewThreadDraft, loadNewThreadDraft, saveNewThreadDraft } from "./new-thread-draft";

describe("new thread draft", () => {
  it("round-trips the picker state", () => {
    saveNewThreadDraft({
      projectId: "p1",
      model: { provider: "p", modelId: "m" },
      thinkingLevel: "high",
      workspace: "checkout",
    });
    expect(loadNewThreadDraft()).toEqual({
      projectId: "p1",
      model: { provider: "p", modelId: "m" },
      thinkingLevel: "high",
      workspace: "checkout",
    });
    clearNewThreadDraft();
    expect(loadNewThreadDraft()).toEqual({
      projectId: null,
      model: null,
      thinkingLevel: null,
      workspace: null,
    });
  });

  it("rejects invalid shapes", () => {
    window.localStorage.setItem(
      "tau:new-thread-draft",
      JSON.stringify({ projectId: 42, model: { provider: "p" }, thinkingLevel: "huge", workspace: "nope" }),
    );
    expect(loadNewThreadDraft()).toEqual({
      projectId: null,
      model: null,
      thinkingLevel: null,
      workspace: null,
    });
    clearNewThreadDraft();
  });

  it("returns empty on corrupt JSON", () => {
    window.localStorage.setItem("tau:new-thread-draft", "{nope");
    expect(loadNewThreadDraft().projectId).toBeNull();
    clearNewThreadDraft();
  });
});
