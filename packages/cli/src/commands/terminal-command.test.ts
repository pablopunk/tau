import { describe, expect, it } from "vitest";
import type { CommandEnv, SocketLike } from "./command-env";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome } from "./test-support";

function harness() {
  const fake = new FakeTau();
  fake.answers.set("GET /api/terminals/available", { status: 200, body: { available: true } });
  const sent: unknown[] = [];
  const socket: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => {
      sent.push(data);
    },
    close: () => undefined,
  };
  let input: (line: string) => void = () => undefined;
  let eof: () => void = () => undefined;
  let interrupt: () => void = () => undefined;
  let opened = "";
  const env = fake.env(makeHome(), {
    openSocket: (url) => {
      opened = url;
      queueMicrotask(() =>
        socket.onmessage?.({ data: JSON.stringify({ type: "ready", status: "running", exitCode: null }) }),
      );
      return socket;
    },
    terminalInput: (line, end) => {
      input = line;
      eof = end;
      return () => undefined;
    },
    onInterrupt: (fn) => {
      interrupt = fn;
      return () => undefined;
    },
  } satisfies Partial<CommandEnv>);
  return {
    fake,
    env,
    socket,
    sent,
    input: (s: string) => input(s),
    eof: () => eof(),
    interrupt: () => interrupt(),
    opened: () => opened,
    ready: async () => {
      while (sent.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("terminal attach machine observer", () => {
  it("orders ready, binary replay/live and actual exit; resizes after ready", async () => {
    const h = harness();
    const run = executeApiCommand("terminals", ["attach", "term7", "--machine"], h.env);
    await h.ready();
    expect(h.sent).toEqual(['{"type":"resize","cols":80,"rows":24}']);
    h.socket.onmessage?.({ data: Buffer.from([255, 0]) });
    h.socket.onmessage?.({ data: Buffer.from([128]) });
    h.socket.onmessage?.({ data: '{"type":"exit","exitCode":0}' });
    await run;
    const frames = h.fake.stdout.map((line) => JSON.parse(line));
    expect(frames.map((f) => f.event?.sequence ?? null)).toEqual([0, 1, 2, 3, null]);
    expect(frames[1].event.frame.data).toBe("/wA=");
    expect(frames[2].event.frame.data).toBe("gA==");
    expect(frames.every((f) => f.terminalId === "term7" && f.lifecycle === null)).toBe(true);
  });
  it("EOF detaches; input is decoded binary and does not close the process", async () => {
    const h = harness();
    const run = executeApiCommand("terminals", ["attach", "term7", "--machine"], h.env);
    await h.ready();
    h.input('{"type":"input","encoding":"base64","data":"/wA="}');
    h.eof();
    await run;
    expect(h.sent[1]).toEqual(Buffer.from([255, 0]));
    expect(JSON.parse(h.fake.stdout.at(-1) as string)).toMatchObject({
      kind: "terminal",
      result: "detached",
      lifecycle: null,
    });
    expect(h.fake.calls.every((call) => call.method !== "DELETE")).toBe(true);
  });
  it("SIGINT detaches with 130, never a terminal kill", async () => {
    const h = harness();
    const run = executeApiCommand("terminals", ["attach", "term7", "--machine"], h.env);
    const rejected = expect(run).rejects.toMatchObject({ exitCode: 130, code: "wait_interrupted" });
    await h.ready();
    h.interrupt();
    await rejected;
    expect(h.fake.calls.every((call) => call.method !== "DELETE")).toBe(true);
  });
  it("socket close without exit is unknown, not completion", async () => {
    const h = harness();
    const run = executeApiCommand("terminals", ["attach", "term7", "--machine"], h.env);
    const rejected = expect(run).rejects.toMatchObject({ exitCode: 1, code: "connection_lost" });
    await h.ready();
    h.socket.onclose?.();
    await rejected;
    expect(JSON.parse(h.fake.stdout.at(-1) as string)).toMatchObject({ kind: "error", terminalId: "term7" });
  });
  it("unsupported capability refuses before opening the socket", async () => {
    const h = harness();
    h.fake.answers.set("GET /api/terminals/available", { status: 200, body: { available: false } });
    await expect(
      executeApiCommand("terminals", ["attach", "term7", "--machine"], h.env),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(h.opened()).toBe("");
  });
});
