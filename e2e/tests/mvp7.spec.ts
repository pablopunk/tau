import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { demoRepository, serverEnvironment } from "../support";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../../packages/cli/dist/bin.js", import.meta.url));
const CLI_PORT = 4398;

const home = realpathSync(mkdtempSync(join(tmpdir(), "tau-e2e-cli-")));
const env = { ...process.env, ...serverEnvironment(), TAU_HOME: home };

async function tau(...args: string[]): Promise<string> {
  const { stdout } = await run("node", [CLI, ...args], { env, timeout: 60_000 });
  return stdout;
}

const json = async (...args: string[]) => JSON.parse(await tau(...args));

async function startThreadAndWait(text: string, projectId: string): Promise<string> {
  const { id } = await json("threads", "start", text, "--project", projectId);
  await tau("threads", "wait", id, "--timeout", "60");
  return id;
}

test.describe.configure({ mode: "serial" });

test.describe("MVP7 tau commands", () => {
  test.afterAll(async () => {
    await tau("stop").catch(() => undefined);
  });

  test("start runs a detached server, status reports it, stop ends it", async () => {
    await tau("start", "--faux", "--no-open", "--port", String(CLI_PORT));
    const status = await json("status", "--json");
    expect(status).toMatchObject({ installed: false, url: `http://127.0.0.1:${CLI_PORT}` });
    expect(status.running).toBeTruthy();
    await tau("stop");
    expect((await json("status", "--json")).running).toBeFalsy();
    await tau("start", "--faux", "--no-open");
  });

  test("a faux thread's bash can use tau, and a shell can read the thread", async () => {
    await tau("providers", "set-key", "openrouter", "sk-or-v1-faux");
    const [model] = (await json("models", "list")) as { provider: string; modelId: string }[];
    await tau("settings", "set-default-model", `${model?.provider}/${model?.modelId}`);
    const project = await json("projects", "add", demoRepository());

    const listing = join(home, "projects.out");
    const listed = await startThreadAndWait(`bash tau projects list > ${listing}`, project.id);
    expect(readFileSync(listing, "utf8")).toContain(project.id);
    expect(await tau("threads", "read", listed)).toContain("tau projects list");

    const nested = join(home, "nested.out");
    const command = `tau threads start hello --project ${project.id} --wait > ${nested}`;
    await startThreadAndWait(`bash ${command}`, project.id);
    expect(readFileSync(nested, "utf8")).toContain("This is a scripted reply from the faux model");
  });
});
