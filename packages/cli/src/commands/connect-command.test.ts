import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilePeersStore, peersFilePath } from "@tau/core";
import { generateNodeKeys, nodeIdOf } from "@tau/protocol/identity";
import { describe, expect, it, vi } from "vitest";

import type { AfterLink, ConnectIo } from "../nodes/connect-io";
import { CliExit } from "./cli-exit";
import type { CommandEnv } from "./command-env";
import { executeConnect, executeDisconnect } from "./connect-command";
import { makeHome } from "./test-support";

const runBare = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../lifecycle/bare", () => ({ runBare }));

const SECRET = "x".repeat(43);
const LINK = "https://hub.example.com/pair#ABCD2345.Home%20hub&node=n-peer";

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

const io = (answer = true, start: AfterLink = "none"): ConnectIo => ({
  confirm: vi.fn(async () => answer),
  chooseStart: vi.fn(async () => start),
});

const hubAnswers = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const emptyHome = () => mkdtempSync(join(tmpdir(), "tau-connect-"));

const peersOf = (home: string) => createFilePeersStore(peersFilePath(home));
const peer = (extra = {}) => ({ url: "https://a.b", name: "A", secret: SECRET, nodeId: "n-a", ...extra });

describe("tau connect", () => {
  it("refuses, before asking or redeeming, when the running tau is older than this command", async () => {
    const home = emptyHome();
    writeFileSync(
      join(home, "lock"),
      JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:1", version: "0.1.2" }),
    );
    const fetchImpl = hubAnswers({ deviceId: "d1", secret: SECRET, nodeId: "n-peer" });
    const questions = io();
    const { env } = envFor(home, fetchImpl);
    const refused = executeConnect([LINK], env, questions, "0.2.2");
    await expect(refused).rejects.toThrow(/running here is 0\.1\.2.*\n.*\n.*tau update/s);
    expect(questions.confirm).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await peersOf(home).read()).toEqual([]);
  });

  it("prints its help, with --node and without the old --hub", async () => {
    const { env, out } = envFor(emptyHome(), hubAnswers({}));
    await executeConnect(["--help"], env, io());
    expect(out.join("\n")).toMatch(/--node/);
    expect(out.join("\n")).not.toMatch(/--hub/);
  });

  it("asks, redeems with the peer origin, and stores the pinned peer privately", async () => {
    const home = emptyHome();
    const fetchImpl = hubAnswers({ deviceId: "d1", secret: SECRET, nodeId: "n-peer" });
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
    expect(await peersOf(home).read()).toEqual([
      {
        url: "https://hub.example.com",
        name: "Home hub",
        secret: SECRET,
        nodeName: "Laptop",
        nodeId: "n-peer",
      },
    ]);
    expect(statSync(join(home, "peers.json")).mode & 0o777).toBe(0o600);
    expect(out.join("\n")).not.toContain(SECRET);
  });

  it("takes a short code with --node and skips the question with --yes", async () => {
    const home = emptyHome();
    const questions = io();
    const { env } = envFor(home, hubAnswers({ deviceId: "d", secret: SECRET, nodeId: "n-x" }));
    await executeConnect(["ABCD2345", "--node", "http://127.0.0.1:9", "--yes"], env, questions);
    expect(questions.confirm).not.toHaveBeenCalled();
    expect((await peersOf(home).read())[0]).toMatchObject({ url: "http://127.0.0.1:9", nodeId: "n-x" });
  });

  it("runs the bare flow after linking when the answer is yes, else says `tau`", async () => {
    const answers = () => hubAnswers({ deviceId: "d1", secret: SECRET, nodeId: "n-peer" });
    const yes = envFor(emptyHome(), answers());
    await executeConnect([LINK], yes.env, io(true, "start"));
    expect(runBare).toHaveBeenCalledWith(["--home", yes.env.home, "--no-open"]);
    runBare.mockClear();
    const no = envFor(emptyHome(), answers());
    await executeConnect([LINK], no.env, io());
    expect(runBare).not.toHaveBeenCalled();
    expect(no.out.join("\n")).toContain("Run `tau` to bring this node online.");
  });

  it("writes nothing when the answer is no", async () => {
    const home = emptyHome();
    const fetchImpl = hubAnswers({});
    const { env } = envFor(home, fetchImpl);
    await expect(executeConnect([LINK], env, io(false))).rejects.toBeInstanceOf(CliExit);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await peersOf(home).read()).toEqual([]);
  });

  it("refuses a node it already links to, by url or node id", async () => {
    const home = emptyHome();
    await peersOf(home).write([peer({ url: "https://other.test", nodeId: "n-peer" })]);
    const { env } = envFor(home, hubAnswers({}));
    await expect(executeConnect([LINK, "--yes"], env, io())).rejects.toThrow("already linked");
  });

  it("links a second node: this node may link to every other", async () => {
    const home = emptyHome();
    await peersOf(home).write([peer()]);
    const { env } = envFor(home, hubAnswers({ deviceId: "d", secret: SECRET, nodeId: "n-peer" }));
    await executeConnect([LINK, "--yes"], env, io());
    expect((await peersOf(home).read()).map((entry) => entry.name)).toEqual(["A", "Home hub"]);
  });

  it("refuses a link to itself", async () => {
    const home = emptyHome();
    const keys = generateNodeKeys();
    writeFileSync(join(home, "node.json"), JSON.stringify({ version: 1, ...keys, createdAt: 1 }));
    const { env } = envFor(home, hubAnswers({}));
    const own = `https://hub.example.com/pair#C0DE.Me&node=${nodeIdOf(keys.publicKey)}`;
    await expect(executeConnect([own, "--yes"], env, io())).rejects.toThrow("itself");
    expect(existsSync(join(home, "peers.json"))).toBe(false);
  });

  it("refuses when the node that answers is not the one in the link", async () => {
    const home = emptyHome();
    const { env } = envFor(home, hubAnswers({ deviceId: "d", secret: SECRET, nodeId: "n-other" }));
    await expect(executeConnect([LINK, "--yes"], env, io())).rejects.toThrow("not the one in the link");
    expect(await peersOf(home).read()).toEqual([]);
  });

  it("fails calmly on a refused code or an answer without a secret", async () => {
    const { env } = envFor(emptyHome(), hubAnswers({ error: {} }, 400));
    await expect(executeConnect([LINK, "--yes"], env, io())).rejects.toThrow("did not accept");
    const second = envFor(emptyHome(), hubAnswers({ deviceId: "d" }));
    await expect(executeConnect([LINK, "--yes"], second.env, io())).rejects.toThrow("without a node secret");
  });
});

describe("tau disconnect", () => {
  it("removes the only peer without an argument, and the left-over hub.json", async () => {
    const home = emptyHome();
    await peersOf(home).write([peer()]);
    writeFileSync(
      join(home, "hub.json"),
      JSON.stringify({ nodeUrl: "https://a.b", nodeSecret: SECRET, name: "A" }),
    );
    const { env, out } = envFor(home, hubAnswers({}));
    await executeDisconnect([], env);
    expect(await peersOf(home).read()).toEqual([]);
    expect(existsSync(join(home, "hub.json"))).toBe(false);
    expect(out.join("\n")).toContain("Disconnected from A");
  });

  it("needs a name or id when several nodes are linked", async () => {
    const home = emptyHome();
    await peersOf(home).write([peer(), peer({ url: "https://c.d", name: "C", nodeId: "n-c" })]);
    const { env } = envFor(home, hubAnswers({}));
    await expect(executeDisconnect([], env)).rejects.toThrow("name one");
    await executeDisconnect(["c"], env);
    expect((await peersOf(home).read()).map((entry) => entry.name)).toEqual(["A"]);
    await executeDisconnect(["n-a"], env);
    expect(await peersOf(home).read()).toEqual([]);
  });

  it("tells the running server first", async () => {
    const home = makeHome();
    await peersOf(home).write([peer()]);
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { env } = envFor(home, fetchImpl);
    await executeDisconnect([], env);
    expect(calls).toEqual(["DELETE /api/nodes/n-a"]);
    expect(await peersOf(home).read()).toEqual([]);
  });

  it("says so when nothing is linked", async () => {
    const { env, out } = envFor(emptyHome(), hubAnswers({}));
    await executeDisconnect([], env);
    expect(out).toEqual(["This node is not linked to another node."]);
  });
});
