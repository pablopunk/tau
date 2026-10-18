import { isBaseOps, isRetiredOps } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { allFixtures, finalView, fixtureForMessage, fixtures } from "./index";

const kindsOf = (name: keyof typeof fixtures) =>
  finalView(fixtures[name])?.entries.map((entry) => entry.kind);

describe("recorded fixtures", () => {
  it("apply cleanly from their first frame", () => {
    for (const fixture of allFixtures) {
      expect(isBaseOps(fixture.frames[0]?.ops ?? []), fixture.name).toBe(true);
      expect(() => finalView(fixture), fixture.name).not.toThrow();
    }
  });

  it("end with the run finished, unless retired", () => {
    for (const fixture of allFixtures) {
      const view = finalView(fixture);
      if (view === null) continue;
      expect(view.docs["pi.live"], fixture.name).toEqual({});
    }
  });

  it("show the expected transcript", () => {
    expect(kindsOf("text")).toEqual(["pi.user", "pi.system", "pi.assistant"]);
    expect(kindsOf("write")).toEqual([
      "pi.user",
      "pi.system",
      "pi.assistant",
      "pi.tool-result",
      "pi.assistant",
    ]);
    expect(kindsOf("steer")).toContain("pi.tool-result");
  });

  it("show an image message and a retry after a failure", () => {
    expect(JSON.stringify(finalView(fixtures.image)?.entries[0])).toContain('"type":"image"');
    expect(JSON.stringify(finalView(fixtures.image)?.entries)).toContain("Images received: 1");
    expect(kindsOf("fail-retry")).toContain("app.retry");
    expect(fixtures["fail-retry"].steps.map((step) => step.kind)).toEqual(["send", "retry"]);
  });

  it("include a mid-stream reset and a retired view", () => {
    expect(fixtures.overflow.frames.slice(1).some((frame) => isBaseOps(frame.ops))).toBe(true);
    expect(isRetiredOps(fixtures.retired.frames.at(-1)?.ops ?? [])).toBe(true);
    expect(finalView(fixtures.retired)).toBeNull();
  });

  it("show a retry in flight and a final model error", () => {
    const retryFrames = JSON.stringify(fixtures.retry.frames);
    expect(retryFrames).toContain('"retry":{"at"');
    const errorEntry = finalView(fixtures.error)?.entries.find((entry) => entry.kind === "pi.assistant");
    expect(JSON.stringify(errorEntry)).toContain('"stopReason":"error"');
  });
});

describe("fixtureForMessage", () => {
  it("picks by exact trigger, then command word, then plain text", () => {
    expect(fixtureForMessage("think").name).toBe("thinking");
    expect(fixtureForMessage("fail").name).toBe("error");
    expect(fixtureForMessage("image").name).toBe("image");
    expect(fixtureForMessage("write other.txt hello").name).toBe("write");
    expect(fixtureForMessage("What is a monad?").name).toBe("text");
    expect(fixtureForMessage("anything at all").name).toBe("text");
  });
});
