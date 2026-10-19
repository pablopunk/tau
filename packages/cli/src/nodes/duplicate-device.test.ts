import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore, createFilePeersStore, peerIdOf, peersFilePath } from "@tau/core";
import { type Core, LINK_CLOSE_DUPLICATE, NODE_LINK_PATH } from "@tau/protocol";
import { createServer, type RunningServer } from "@tau/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { secretKeyOf } from "./peer-dialler";

interface Real {
  readonly core: Core;
  readonly server: RunningServer;
  readonly forgotten: string[];
  readonly home: string;
}
const running: Real[] = [];

async function start(): Promise<Real> {
  const home = join(mkdtempSync(join(tmpdir(), "tau-dup-")), "home");
  const core = await createCore({
    home,
    faux: true,
    currentVersion: "0.0.0",
    latestVersion: async () => "0.0.0",
    tunnelTarget: async () => "127.0.0.1:1",
  });
  const forgotten: string[] = [];
  const forget = core.nodes.forget.bind(core.nodes);
  core.nodes.forget = async (id) => {
    forgotten.push(id);
    return forget(id);
  };
  const server = await createServer({ core, port: 0, token: "t".repeat(32) });
  const real = { core, server, forgotten, home };
  running.push(real);
  return real;
}

/** `from` dials `to` with a freshly paired node device, the way `tau connect` does. */
async function dialNew(from: Real, to: Real, label: string) {
  const minted = await to.core.access.mintPairing({ kind: "node" });
  const paired = await to.core.access.redeemPairing({
    code: minted.code,
    deviceName: "B",
    peer: "127.0.0.1",
  });
  const entry = { url: `${to.server.origin}#${label}`, name: "A", secret: paired.secret };
  const store = createFilePeersStore(peersFilePath(from.home));
  await store.write([...(await store.read()), entry]);
  const peerId = peerIdOf(entry);
  const socket = new WebSocket(`ws://127.0.0.1:${to.server.port}${NODE_LINK_PATH}`, {
    headers: { authorization: `Bearer ${paired.secret}` },
  });
  const handle = from.server.attachPeer(socket, "dialler", {
    peerId,
    secretKey: secretKeyOf(paired.secret),
  });
  return { handle, paired };
}

afterEach(async () => {
  for (const real of running.splice(0)) {
    await real.server.close();
    await real.core.close();
  }
});

describe("a refused second device (real core, real server)", () => {
  it("keeps the established link, closes the new one 4002 and revokes the new device exactly once", async () => {
    const [a, b] = [await start(), await start()];
    const first = await dialNew(b, a, "first");
    await vi.waitFor(async () => expect((await a.core.nodes.list())[0]?.status).toBe("online"));
    const devicesBefore = await a.core.access.listDevices();
    expect(devicesBefore.filter((device) => device.kind === "node")).toHaveLength(1);

    const second = await dialNew(b, a, "second");
    expect((await second.handle.closed).code).toBe(LINK_CLOSE_DUPLICATE);
    await vi.waitFor(async () =>
      expect((await a.core.access.listDevices()).map((device) => device.id)).toEqual([first.paired.deviceId]),
    );
    expect(a.forgotten.filter((id) => id === second.paired.deviceId)).toHaveLength(1);
    expect(a.forgotten.filter((id) => id === first.paired.deviceId)).toHaveLength(0);
    expect((await a.core.nodes.list())[0]?.status).toBe("online");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(a.forgotten.filter((id) => id === second.paired.deviceId)).toHaveLength(1);
    first.handle.close(1000, "done");
  });

  it("glare: both dial each other at once and each node lists the other exactly once, online", async () => {
    const [a, b] = [await start(), await start()];
    const [toB, toA] = await Promise.all([dialNew(a, b, "glare-ab"), dialNew(b, a, "glare-ba")]);
    await Promise.race([toB.handle.closed, toA.handle.closed]);
    for (const real of [a, b]) {
      await vi.waitFor(
        async () => {
          const nodes = await real.core.nodes.list();
          expect(nodes.map((node) => node.status)).toEqual(["online"]);
        },
        { timeout: 5000 },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const real of [a, b]) expect(await real.core.nodes.list()).toHaveLength(1);
    expect(a.forgotten).toEqual([]);
    expect(b.forgotten).toEqual([]);
  });
});
