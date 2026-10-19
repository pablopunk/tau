import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConnectIo } from "../nodes/connect-io";
import { createHubFileStore } from "../nodes/hub-file";
import { CliExit } from "./cli-exit";
import type { CommandEnv } from "./command-env";
import { executeConnect, executeDisconnect } from "./connect-command";
import { makeHome } from "./test-support";

const SECRET = "x".repeat(43);
const LINK = "https://hub.example.com/pair#ABCD2345.Home%20hub";

function envFor(home: string, fetchImpl: typeof fetch) {
  const out: string[] = [];
  const env = {
    home,
    env: {},
    stdout: (text: string) => void out.push(text),
    stderr: (text: string) => void out.push(text),
    fetch: fetchImpl,
    sleep: async () => undefined,
    now: Date.now,
    startupWaitMs: 10,
    pollMs: 10,
  } as unknown as CommandEnv;
  return { env, out };
}

const io = (answer = true): ConnectIo => ({
  confirm: vi.fn(async () => answer),
  chooseStart: vi.fn(async () => "none" as const),
});

const hubAnswers = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const emptyHome = () => mkdtempSync(join(tmpdir(), "tau-connect-"));

describe("tau connect", () => {
  it("asks, redeems with the hub origin, and stores hub.json privately", async () => {
    const home = emptyHome();
    const fetchImpl = hubAnswers({ deviceId: "d1", secret: SECRET });
    const questions = io();
    const { env, out } = envFor(home, fetchImpl);
    await executeConnect([LINK, "--name", "Laptop"], env, questions);
    expect(questions.confirm).toHaveBeenCalledWith(expect.stringContaining("Link this node to Home hub"));
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hub.example.com/api/pair/redeem");
    expect(init.headers).toMatchObject({
      origin: "https://hub.example.com",
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({ code: "ABCD2345", deviceName: "Laptop" });
    expect(await createHubFileStore(home).read()).toEqual({
      hubUrl: "https://hub.example.com",
      nodeSecret: SECRET,
      name: "Home hub",
      nodeName: "Laptop",
    });
    expect(statSync(join(home, "hub.json")).mode & 0o777).toBe(0o600);
    expect(out.join("\n")).not.toContain(SECRET);
  });

  it("takes a short code with --hub and skips the question with --yes", async () => {
    const home = emptyHome();
    const questions = io();
    const { env } = envFor(home, hubAnswers({ deviceId: "d", secret: SECRET }));
    await executeConnect(["ABCD2345", "--hub", "http://127.0.0.1:9", "--yes"], env, questions);
    expect(questions.confirm).not.toHaveBeenCalled();
    expect((await createHubFileStore(home).read())?.hubUrl).toBe("http://127.0.0.1:9");
  });

  it("writes nothing when the answer is no", async () => {
    const home = emptyHome();
    const fetchImpl = hubAnswers({});
    const { env } = envFor(home, fetchImpl);
    await expect(executeConnect([LINK], env, io(false))).rejects.toBeInstanceOf(CliExit);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await createHubFileStore(home).read()).toBeUndefined();
  });

  it("refuses when already linked", async () => {
    const home = emptyHome();
    await createHubFileStore(home).write({ hubUrl: "https://a.b", nodeSecret: SECRET, name: "A" });
    const { env } = envFor(home, hubAnswers({}));
    await expect(executeConnect([LINK, "--yes"], env, io())).rejects.toThrow("already linked");
  });

  it("refuses when nodes are linked to this tau", async () => {
    const home = emptyHome();
    mkdirSync(join(home, "machines", "m1"), { recursive: true });
    const { env } = envFor(home, hubAnswers({}));
    await expect(executeConnect([LINK, "--yes"], env, io())).rejects.toThrow("Disconnect them first");
  });

  it("fails calmly on a refused code or an answer without a secret", async () => {
    const { env } = envFor(emptyHome(), hubAnswers({ error: {} }, 400));
    await expect(executeConnect([LINK, "--yes"], env, io())).rejects.toThrow("did not accept");
    const second = envFor(emptyHome(), hubAnswers({ deviceId: "d" }));
    await expect(executeConnect([LINK, "--yes"], second.env, io())).rejects.toThrow("without a node secret");
  });
});

describe("tau disconnect", () => {
  it("removes hub.json when no server runs", async () => {
    const home = emptyHome();
    const store = createHubFileStore(home);
    await store.write({ hubUrl: "https://a.b", nodeSecret: SECRET, name: "A" });
    const { env, out } = envFor(home, hubAnswers({}));
    await executeDisconnect([], env);
    expect(await store.read()).toBeUndefined();
    expect(out.join("\n")).toContain("Disconnected from A");
  });

  it("tells the running server first", async () => {
    const home = makeHome();
    const store = createHubFileStore(home);
    await store.write({ hubUrl: "https://a.b", nodeSecret: SECRET, name: "A" });
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(url).pathname}`);
      return url.endsWith("/hub")
        ? new Response(
            JSON.stringify({ state: "linked", hubName: "A", hubUrl: null, since: 1, message: null }),
          )
        : new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { env } = envFor(home, fetchImpl);
    await executeDisconnect([], env);
    expect(calls).toEqual(["GET /api/nodes/hub", "POST /api/nodes/hub/disconnect"]);
    expect(await store.read()).toBeUndefined();
  });

  it("says so when nothing is linked", async () => {
    const { env, out } = envFor(emptyHome(), hubAnswers({}));
    await executeDisconnect([], env);
    expect(out).toEqual(["This tau is not linked to a hub."]);
  });
});
