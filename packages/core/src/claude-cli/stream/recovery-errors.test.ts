import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClaudeQuery, ClaudeQueryOptions, ClaudeSdkMessage, ClaudeSdkPort } from "../sdk-types";
import { scriptOf } from "../testing/fake-claude-script";
import { IDLE_CLOSE_MS } from "./lifecycle";
import {
  ask,
  createHarness,
  getWord,
  type Harness,
  systemMessage,
  textOfMessage,
  userMessage,
} from "./test-support";

const STALE_TEXT = "No conversation found with session ID: fake-session-1";
const say = (text: string) => [{ kind: "text" as const, text }];

type Breakage = "launch rejection" | "iterator failure" | "error result";

const staleResult: ClaudeSdkMessage = {
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
  session_id: "session-the-cli-made-up",
  errors: [STALE_TEXT],
};

function brokenQuery(breakage: Exclude<Breakage, "launch rejection">): ClaudeQuery {
  const never = async () => undefined;
  return {
    async *[Symbol.asyncIterator]() {
      if (breakage === "iterator failure") throw new Error(STALE_TEXT);
      yield staleResult;
    },
    interrupt: never,
    setModel: never,
    applyFlagSettings: never,
    isAutoCompactEnabled: async () => true,
    mcpServerStatus: async () => [],
    close: () => undefined,
  };
}

interface Starts {
  readonly resumes: (string | undefined)[];
}

function breakingPort(
  port: ClaudeSdkPort,
  starts: Starts,
  shouldBreak: (options: ClaudeQueryOptions) => Breakage | null,
): ClaudeSdkPort {
  return {
    ...port,
    startQuery(options) {
      starts.resumes.push(options.resume);
      const breakage = shouldBreak(options);
      if (breakage === null) return port.startQuery(options);
      if (breakage === "launch rejection") throw new Error(STALE_TEXT);
      return brokenQuery(breakage);
    },
  };
}

let dir = "";
let bindingsFile = "";
const withFile: Harness[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tau-recovery-"));
  bindingsFile = join(dir, "bindings.json");
});

afterEach(async () => {
  await Promise.all(withFile.splice(0).map((harness) => harness.streamer.closeAll()));
  await rm(dir, { recursive: true, force: true });
});

const savedSessionOf = async (id: string): Promise<string | undefined> =>
  JSON.parse(await readFile(bindingsFile, "utf8"))[id]?.sdkSessionId;

function harnessWhereResumeIsStale(breakage: Breakage, starts: Starts, script = scriptOf([say("fine")])) {
  const harness = createHarness({
    bindingsFile,
    script,
    wrap: (port) => breakingPort(port, starts, (options) => (options.resume ? breakage : null)),
  });
  withFile.push(harness);
  return harness;
}

async function secondTurnAfterIdle(harness: Harness) {
  const base = [systemMessage(), userMessage("a")];
  const first = await ask(harness, base);
  harness.clock.advance(IDLE_CLOSE_MS + 1);
  return ask(harness, [...base, first.message, userMessage("b")]);
}

const toolRuns = (harness: Harness) => harness.fake.queries.flatMap((query) => query.toolCalls);

describe.each<Breakage>(["launch rejection", "iterator failure", "error result"])(
  "a stale session reported as %s",
  (breakage) => {
    it("rebinds exactly once, answers, and runs no tool", async () => {
      const starts: Starts = { resumes: [] };
      const harness = harnessWhereResumeIsStale(breakage, starts);
      const second = await secondTurnAfterIdle(harness);
      expect(second.message.stopReason).toBe("stop");
      expect(textOfMessage(second.message)).toBe("fine");
      expect(starts.resumes).toEqual([undefined, "fake-session-1", undefined]);
      expect(harness.fake.queries[1]?.inputs[0]).toContain("<conversation-so-far>");
      expect(toolRuns(harness)).toEqual([]);
    });

    it("keeps only the rebound session on disk and forgets the stale one", async () => {
      const starts: Starts = { resumes: [] };
      const harness = harnessWhereResumeIsStale(breakage, starts);
      await secondTurnAfterIdle(harness);
      await harness.streamer.closeAll();
      expect(await savedSessionOf("thread-1")).toBe(harness.fake.queries[1]?.sessionId);
    });

    it("never retries a second time when the rebind fails too", async () => {
      const starts: Starts = { resumes: [] };
      let launches = 0;
      const harness = createHarness({
        script: scriptOf([say("fine")]),
        wrap: (port) => breakingPort(port, starts, () => (++launches > 1 ? breakage : null)),
      });
      const second = await secondTurnAfterIdle(harness);
      expect(second.message.stopReason).toBe("error");
      expect(starts.resumes).toEqual([undefined, "fake-session-1", undefined]);
    });
  },
);

describe("a stale looking failure after the model already started answering", () => {
  const toolThenStale = scriptOf([say("one"), [{ kind: "tools", calls: [{ name: "get_word" }] }]]);

  it("is an error: no rebind, so no tool can run twice", async () => {
    const starts: Starts = { resumes: [] };
    const harness = createHarness({
      script: (turn, text, hasTools) =>
        text === "b"
          ? [{ kind: "tools", calls: [{ name: getWord.name }] }]
          : toolThenStale(turn, text, hasTools),
      wrap: (port) => ({
        ...port,
        startQuery(options) {
          starts.resumes.push(options.resume);
          const query = port.startQuery(options);
          if (!options.resume) return query;
          return {
            ...query,
            async *[Symbol.asyncIterator]() {
              for await (const message of query) {
                yield message;
                if (message.type === "stream_event") throw new Error(STALE_TEXT);
              }
            },
          };
        },
      }),
    });
    const second = await secondTurnAfterIdle(harness);
    expect(second.message.stopReason).toBe("error");
    expect(starts.resumes).toEqual([undefined, "fake-session-1"]);
    expect(toolRuns(harness).length).toBeLessThanOrEqual(1);
  });
});
