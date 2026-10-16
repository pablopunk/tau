import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseOps } from "@pi-everywhere/protocol";
import type { Fixture, FixtureFrame, FixtureStep } from "@pi-everywhere/testkit";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "../harness/open";
import { createAgentRegistry } from "../harness/registry";
import { createFauxSetup } from "./faux-provider";
import type { Scenario } from "./fixture-scenarios";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const SEED_FILES = { "notes.txt": "hello world\n" };

async function createProject(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pie-fixture-")));
  const dir = join(root, "project");
  await mkdir(dir);
  for (const [name, content] of Object.entries(SEED_FILES)) await writeFile(join(dir, name), content);
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export const DEMO_PROJECT_DIR = "/Users/demo/project";

function scrubPaths(value: unknown, dir: string): unknown {
  return JSON.parse(JSON.stringify(value).split(dir).join(DEMO_PROJECT_DIR));
}

async function runSteps(
  scenario: Scenario,
  conversation: Awaited<ReturnType<typeof createConversation>>,
  t0: number,
) {
  const recordedSteps: FixtureStep[] = [];
  for (const step of scenario.steps) {
    await sleep(Math.max(0, step.at - (Date.now() - t0)));
    const at = Date.now() - t0;
    if (step.kind === "send") {
      await conversation.submit({ type: "input", content: step.text, whenBusy: "steer" }, BACKGROUND);
      recordedSteps.push({ at, kind: "send", text: step.text });
    } else {
      await conversation.abort(BACKGROUND);
      recordedSteps.push({ at, kind: "abort" });
    }
  }
  return recordedSteps;
}

async function createConversation(harness: Awaited<ReturnType<typeof openAgentHarness>>, cwd: string) {
  return harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: { model: { provider: "faux", modelId: "faux-1" }, cwd } },
    BACKGROUND,
  );
}

export async function recordScenario(scenario: Scenario): Promise<Fixture> {
  const project = await createProject();
  const storagePath = join(project.dir, "..", "agent.sqlite");
  const { models } = createFauxSetup({ tokensPerSecond: 60 });
  const storage = await openSqliteStorage(storagePath);
  const harness = await openAgentHarness({
    storage,
    models,
    registry: createAgentRegistry(),
    settings: scenario.settings,
    onReport: (error) => console.error("harness report:", error),
  });
  try {
    const conversation = await createConversation(harness, project.dir);
    const watch = await conversation.watch(BACKGROUND);
    const t0 = Date.now();
    const frames: FixtureFrame[] = [{ at: 0, ops: baseOps(watch.value) }];
    watch.start(async (_value, ops) => {
      frames.push({ at: Date.now() - t0, ops });
      if (scenario.consumerStall?.afterFrames === frames.length) await sleep(scenario.consumerStall.ms);
    });
    const steps = await runSteps(scenario, conversation, t0);
    await conversation.waitForIdle(BACKGROUND);
    await sleep(300);
    await watch.stop();
    const fixture: Fixture = {
      name: scenario.name,
      description: scenario.description,
      conversationId: String(conversation.id),
      steps,
      frames,
    };
    return scrubPaths(fixture, project.dir) as Fixture;
  } finally {
    await harness.close(BACKGROUND);
    await project.cleanup();
  }
}
