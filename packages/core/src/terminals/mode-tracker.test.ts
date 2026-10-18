import { describe, expect, it } from "vitest";
import { createModeTracker } from "./mode-tracker";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("mode tracker", () => {
  it("records the last state of each tracked mode", () => {
    const tracker = createModeTracker();
    tracker.scan(bytes("\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[?25h"));
    expect(tracker.prefix()).toBe("\x1b[?1049h\x1b[?25h\x1b[?2004h");
  });

  it("handles several modes in one sequence and ignores untracked ones", () => {
    const tracker = createModeTracker();
    tracker.scan(bytes("\x1b[?1000;1006h\x1b[?7l"));
    expect(tracker.prefix()).toBe("\x1b[?1000h\x1b[?1006h");
  });

  it("finds a sequence split at every byte boundary", () => {
    const text = "ab\x1b[?1049hcd";
    for (let cut = 1; cut < text.length; cut++) {
      const tracker = createModeTracker();
      tracker.scan(bytes(text.slice(0, cut)));
      tracker.scan(bytes(text.slice(cut)));
      expect(tracker.prefix()).toBe("\x1b[?1049h");
    }
  });

  it("keeps the state after the ring wrapped (it never forgets)", () => {
    const tracker = createModeTracker();
    tracker.scan(bytes("\x1b[?1049h"));
    for (let index = 0; index < 1000; index++) tracker.scan(bytes("lots of output\r\n"));
    expect(tracker.prefix()).toBe("\x1b[?1049h");
    tracker.scan(bytes("\x1b[?1049l"));
    expect(tracker.prefix()).toBe("\x1b[?1049l");
  });
});
