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

const currentVersion = () => readlinkSync(join(server.installDir, "current")).split("/").pop();

test.beforeAll(async () => {
  test.setTimeout(300_000);
  const releases = await ensureReleases();
  github = await serveReleases(releases, GOOD_VERSION);
  server = await startBinaryServer(releases, github);
});
test.afterAll(async () => {
  await server?.stop();
  await github?.close();
});

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
  await expect
    .poll(async () => (await statusOf(request).catch(() => undefined))?.job.state, { timeout: 60_000 })
    .toBe("idle");
});

test("a broken release rolls back to the previous version", async ({ request }) => {
  test.setTimeout(180_000);
  github.latest = BROKEN_VERSION;
  await server.tau("restart");
  await expect
    .poll(
      async () =>
        ((await statusOf(request).catch(() => undefined)) as { latest?: string } | undefined)?.latest,
      {
        timeout: 60_000,
      },
    )
    .toBe(BROKEN_VERSION);
  const started = await request.post(`${server.baseURL}/api/update/start`, {
    data: { target: BROKEN_VERSION, force: true },
    headers: headers(),
  });
  expect(started.status()).toBe(202);
  await expect
    .poll(async () => (await statusOf(request).catch(() => undefined))?.job.state, { timeout: 120_000 })
    .toBe("failed");
  expect(currentVersion()).toBe(GOOD_VERSION);
  expect((await statusOf(request)).current).toBe(GOOD_VERSION);
});
