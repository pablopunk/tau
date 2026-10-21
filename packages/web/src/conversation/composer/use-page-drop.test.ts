import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePageDrag } from "./use-page-drop";

function filesDrag(type: string): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"] } });
  return event;
}

function plainDrag(type: string): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["text/plain"] } });
  return event;
}

function fire(event: Event) {
  act(() => window.dispatchEvent(event));
}

function setup(enabled = true) {
  return renderHook(() => usePageDrag(enabled)).result;
}

describe("usePageDrag", () => {
  it("arms on a file dragenter and disarms on drop", () => {
    const current = setup();
    fire(filesDrag("dragenter"));
    expect(current.current[0]).toBe(true);
    fire(filesDrag("drop"));
    expect(current.current[0]).toBe(false);
  });

  it("ignores drags that carry no files", () => {
    const current = setup();
    fire(plainDrag("dragenter"));
    expect(current.current[0]).toBe(false);
  });

  it("disarms when the pointer leaves the window", () => {
    const current = setup();
    fire(filesDrag("dragenter"));
    expect(current.current[0]).toBe(true);
    const leave = filesDrag("dragleave");
    Object.defineProperty(leave, "relatedTarget", { value: null });
    fire(leave);
    expect(current.current[0]).toBe(false);
  });

  it("disarms on Escape: cancelling a drag delivers no drop/dragend/dragleave", () => {
    const current = setup();
    fire(filesDrag("dragenter"));
    expect(current.current[0]).toBe(true);
    fire(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(current.current[0]).toBe(false);
  });

  it("disarms when the window loses focus mid-drag", () => {
    const current = setup();
    fire(filesDrag("dragenter"));
    expect(current.current[0]).toBe(true);
    fire(new Event("blur"));
    expect(current.current[0]).toBe(false);
  });

  it("disarms on pointerdown: no press can happen while a drag is live", () => {
    const current = setup();
    fire(filesDrag("dragenter"));
    expect(current.current[0]).toBe(true);
    fire(new Event("pointerdown", { bubbles: true }));
    expect(current.current[0]).toBe(false);
  });

  it("stays disarmed when disabled", () => {
    const current = setup(false);
    fire(filesDrag("dragenter"));
    expect(current.current[0]).toBe(false);
  });
});
