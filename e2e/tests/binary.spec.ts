import { readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  type BinaryServer,
  BROKEN_VERSION,
  ensureReleases,
  type FakeGitHub,
  GOOD_VERSION,
  INSTALLED_VERSION,
  serveReleases,
  startBinaryServer,
  updateDiagnostics,
} from "../binary-support";

test.describe.configure({ mode: "serial" });

interface UpdateState {
  current: string;
  job: { state: string; target?: string; error?: string | null };
}

let server: BinaryServer;
let github: FakeGitHub;

const headers = () => ({
  authorization: `Bearer ${readFileSync(join(server.home, "token"), "utf8").trim()}`,
  origin: server.baseURL,
});

async function statusOf(request: import("@playwright/test").APIRequestContext): Promise<UpdateState> {
  return (await (
    await request.get(`${server.baseURL}/api/update`, { headers: headers() })
  ).json()) as UpdateState;
}

/** The updater child records its pid in update.json and exits after the new server answers. */
function updateChildGone(): boolean {
  const { pid } = JSON.parse(readFileSync(join(server.home, "update.json"), "utf8")) as { pid: number };
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

const currentVersion = () => readlinkSync(join(server.installDir, "current")).split("/").pop();

async function boot(latest: string): Promise<void> {
  test.setTimeout(300_000);
  const releases = await ensureReleases();
  github = await serveReleases(releases, latest);
  server = await startBinaryServer(releases, github);
}
async function shutdown(): Promise<void> {
  await server?.stop();
  await github?.close();
}

test.describe("a good release", () => {
  test.beforeAll(() => boot(GOOD_VERSION));
  test.afterEach(({}, info) => {
    if (info.status !== info.expectedStatus && server) console.log(updateDiagnostics(server));
  });
  test.afterAll(shutdown);

  test("updates the installed binary to a fake release", async ({ request }) => {
    test.setTimeout(180_000);
    expect((await statusOf(request)).current).toBe(INSTALLED_VERSION);
    const started = await request.post(`${server.baseURL}/api/update/start`, {
      data: { target: GOOD_VERSION, force: true },
      headers: headers(),
    });
    expect(started.status()).toBe(202);
    await expect
      .poll(async () => (await statusOf(request).catch(() => undefined))?.current, {
        timeout: 120_000,
      })
      .toBe(GOOD_VERSION);
    expect(currentVersion()).toBe(GOOD_VERSION);
    await expect.poll(updateChildGone, { timeout: 60_000 }).toBe(true);
  });
});

test.describe("a broken release", () => {
  test.beforeAll(() => boot(BROKEN_VERSION));
  test.afterAll(shutdown);

  test("a broken release rolls back to the previous version", async ({ request }) => {
    test.setTimeout(180_000);
    const started = await request.post(`${server.baseURL}/api/update/start`, {
      data: { target: BROKEN_VERSION, force: true },
      headers: headers(),
    });
    expect(started.status()).toBe(202);
    await expect
      .poll(async () => (await statusOf(request).catch(() => undefined))?.job.state, { timeout: 120_000 })
      .toBe("failed");
    expect(currentVersion()).toBe(INSTALLED_VERSION);
    expect((await statusOf(request)).current).toBe(INSTALLED_VERSION);
  });
});
