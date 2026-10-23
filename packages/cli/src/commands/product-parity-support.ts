import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConversationView, nextViewState } from "@tau/protocol";
import { createServer } from "@tau/server";
import WebSocket from "ws";
import type { NodeGateway } from "../../../server/src/nodes/gateway";
import { createFakeCore, type FakeCore } from "../../../testkit/src/fake/fake-core";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const token = "C-synthetic-token-not-an-owner-credential";

export async function seedParityCore(name: string): Promise<FakeCore> {
  const core = createFakeCore({
    configured: true,
    speed: 10000,
    nodeName: name,
    fs: { "/synthetic": "directory" },
  });
  for (let i = 2; i <= 7; i++) {
    const thread = await core.conversations.start({
      projectId: "home",
      requestId: `C.seed.${i}`,
      text: "hello",
    });
    if (thread.id !== String(i)) throw new Error("Unexpected seed thread identity");
  }
  return core;
}

export async function createParityHarness(options: { staticDir?: string; cliBinary?: string } = {}) {
  const home = await mkdtemp(join(tmpdir(), "tau-C-parity-"));
  const a = await seedParityCore("C-local-A");
  const b = await seedParityCore("C-remote-B");
  await a.nodesControl.attach(b, "dialled");
  await b.nodesControl.attach(a, "accepted");
  const nodeB = (await b.nodes.self()).nodeId;
  const remote = await createServer({ core: b, port: 0, token });
  let online = true;
  const gateway: NodeGateway = {
    isOnline: (id) => id === nodeB && online,
    request: async (id, request) => {
      if (id !== nodeB || !online) throw new Error("B unavailable");
      const response = await remote.app.inject({
        method: request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        url: `${request.path}${request.query ? `?${request.query}` : ""}`,
        headers: {
          authorization: `Bearer ${token}`,
          host: new URL(remote.origin).host,
          ...(request.contentType ? { "content-type": request.contentType } : {}),
        },
        payload: request.body,
      });
      return {
        status: response.statusCode,
        headers: { "content-type": String(response.headers["content-type"] ?? "application/json") },
        body: response.rawPayload,
      };
    },
    openStream: (id, request, socket) => {
      if (id !== nodeB || !online) {
        socket.close(1013);
        return;
      }
      const upstream = new WebSocket(
        `${remote.origin.replace(/^http/, "ws")}${request.path}${request.query ? `?${request.query}` : ""}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const pending: { data: import("ws").RawData; binary: boolean }[] = [];
      socket.on("message", (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
        else pending.push({ data, binary });
      });
      upstream.on("open", () => {
        for (const frame of pending) upstream.send(frame.data, { binary: frame.binary });
        pending.length = 0;
      });
      upstream.on("message", (data, binary) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary });
      });
      upstream.on("close", () => socket.close());
      upstream.on("error", () => socket.close(1013));
      socket.on("close", () => upstream.close());
    },
    closeNode: () => {
      online = false;
    },
  };
  const local = await createServer({ core: a, port: 0, token, gateway, staticDir: options.staticDir });
  await writeFile(join(home, "token"), token);
  await writeFile(join(home, "lock"), JSON.stringify({ pid: process.pid, url: local.origin }));
  return {
    a,
    b,
    home,
    local,
    remote,
    nodeB,
    disconnect: () => {
      online = false;
    },
    async cli(argv: readonly string[]) {
      const child = spawn(
        options.cliBinary ? resolve(options.cliBinary) : process.execPath,
        [
          ...(options.cliBinary
            ? []
            : ["--import", import.meta.resolve("tsx"), resolve(root, "packages/cli/src/bin.ts")]),
          ...argv,
          "--home",
          home,
        ],
        {
          cwd: root,
          env: { PATH: process.env.PATH, HOME: home, TAU_HOME: home },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const exit = await new Promise<number | null>((resolveExit, reject) => {
        child.on("error", reject);
        child.on("close", resolveExit);
      });
      return {
        exit,
        stdout,
        stderr,
        frames: stdout.trim()
          ? stdout
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
          : [],
      };
    },
    async close() {
      await local.close();
      await remote.close();
      await a.close();
      await b.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

export async function parityView(core: FakeCore, id: string): Promise<ConversationView> {
  let view: ReturnType<typeof nextViewState>;
  const watcher = await core.conversations.watch(id, async (ops) => {
    view = nextViewState(view, ops);
  });
  await watcher.stop();
  if (!view) throw new Error("No seeded view");
  return view;
}

/** Fake persisted views expose user entry IDs, but not request/submission IDs on entries. */
export function parityUserEntries(view: ConversationView, text: string) {
  return view.entries.filter(
    (entry) =>
      entry.kind === "pi.user" &&
      entry.model?.some((message) => message.role === "user" && message.content === text),
  );
}
