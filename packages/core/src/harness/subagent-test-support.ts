import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import type { Harness } from "@earendil-works/pi-durable";
import type { ModelRef, Project, ThinkingLevel } from "@tau/protocol";
import { SUBAGENT_NOTIFICATION_KIND } from "@tau/protocol";
import type { AgentTypeLoader } from "../agents/agent-types";
import type { ResolveModelAlias } from "../agents/model-alias";
import { createChangeEmitter } from "../change-emitter";
import { createConversationRemoval } from "../conversation-removal";
import type { RemovalHooks } from "../removal-hooks";
import { createStatusTracker } from "../status/status-tracker";
import { FAUX_MODELS } from "../testing/faux-provider";
import { createFauxScript } from "../testing/faux-script";
import { createWorkspaceService } from "../workspaces/workspace-service";
import { legacyWorkspace } from "./conversation-index";
import { createConversationStore } from "./conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry } from "./registry";
import { createSubagentRemover } from "./subagent-removal";
import type { SubagentServices } from "./subagent-services";
import { clampThinkingFor } from "./tools/agent-thinking";
import { createToolServicesRef } from "./tools/tool-file";

export const FAUX = { provider: "faux", modelId: "faux-1" };
export const FAUX_TWO = { provider: "faux", modelId: "faux-2" };
export const CALL_PREFIX = "call ";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const callPrompt = (tool: string, args: object) => `${CALL_PREFIX}${tool} ${JSON.stringify(args)}`;

function lastUserText(messages: readonly Message[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  if (!user) return "";
  if (typeof user.content === "string") return user.content;
  return user.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function scriptedToolCall(text: string) {
  const [, name = "", json = "{}"] = /^call (\w+) (.*)$/s.exec(text) ?? [];
  return fauxAssistantMessage([fauxText(`Running ${name}.`), fauxToolCall(name, JSON.parse(json))], {
    stopReason: "toolUse",
  });
}

function withToolCalls(script: FauxResponseFactory): FauxResponseFactory {
  return (context, options, state, model) => {
    const text = lastUserText(context.messages);
    const real = context.messages.filter((message) => (message.role as string) !== "system");
    const lastIsResult = real.at(-1)?.role === "toolResult";
    if (!lastIsResult && text.startsWith(CALL_PREFIX)) return scriptedToolCall(text);
    return script(context, options, state, model);
  };
}

function createCallableFaux() {
  const faux = fauxProvider({ models: FAUX_MODELS });
  const script = withToolCalls(createFauxScript());
  const step: FauxResponseFactory = (...args) => {
    faux.appendResponses([step]);
    return script(...args);
  };
  faux.setResponses(Array.from({ length: 8 }, () => step));
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

export const aliasDouble: ResolveModelAlias = (requested, { connected }) => {
  const wanted = (requested ?? "").trim();
  const found = connected.find((model) => `${model.provider}/${model.modelId}`.includes(wanted));
  if (!found) throw new Error(`No model matches ${wanted}.`);
  return found;
};

export const typesDouble = (types: Awaited<ReturnType<AgentTypeLoader["load"]>>): AgentTypeLoader => ({
  load: async () => types,
  clearCache() {},
});

export type RigOptions = {
  readonly services?: Partial<SubagentServices>;
  readonly project?: Partial<Project>;
  readonly connected?: readonly ModelRef[];
};

export async function openRig(root: string, projectPath: string, options: RigOptions = {}) {
  const project: Project = {
    id: "p1",
    name: "main",
    path: projectPath,
    createdAt: 0,
    kind: "folder",
    status: "ready",
    isGitRepo: false,
    ...options.project,
  };
  const toolServices = createToolServicesRef();
  const models = createCallableFaux();
  const status = createStatusTracker({ changes: createChangeEmitter(), now: Date.now });
  const harness: Harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models,
    registry: createAgentRegistry(toolServices),
    beforeResume: (opened) => status.attach(opened),
  });
  const store = createConversationStore(harness, async () => project.path);
  const workspaces = createWorkspaceService({ home: join(root, "home"), conversations: store });
  const hooks: RemovalHooks = {
    unmergedWork: (thread) => workspaces.unmergedWork(thread),
    onConversationRemoved: [(thread) => workspaces.onConversationRemoved(thread)],
    onProjectRemoved: [],
  };
  const removal = createConversationRemoval({
    conversations: store,
    hooks,
    now: Date.now,
    announce: () => {},
  });
  const remover = createSubagentRemover({ conversations: store, hooks, removal });
  const connected = options.connected ?? [FAUX, FAUX_TWO];
  toolServices.set({
    connectedModels: async () => connected,
    subagents: {
      agentTypes: typesDouble([]),
      resolveModelAlias: aliasDouble,
      fastModel: async () => ({ provider: "faux", modelId: "faux-fast" }),
      clampThinking: (ref: ModelRef, level: ThinkingLevel) => clampThinkingFor(models, ref, level),
      projectOf: async () => project,
      workspaces,
      removeSubagent: (id: string, force: boolean) => remover.remove(id, force),
      ...options.services,
    },
  } as never);
  return rigOver(harness, store, project);
}

function rigOver(harness: Harness, store: ReturnType<typeof createConversationStore>, project: Project) {
  const conversationOf = (id: string) => harness.conversation(Number(id) as never, BACKGROUND);
  const entriesOf = async (id: string) =>
    (await (await conversationOf(id))?.entries({}, 200, undefined, BACKGROUND))?.items ?? [];
  const childrenOf = async (parentId: string) =>
    (await store.list(project.id)).filter((thread) => thread.parentId === parentId);
  const until = async (check: () => Promise<boolean>, attempts = 400) => {
    for (let attempt = 0; attempt < attempts && !(await check()); attempt++) await sleep(25);
  };
  return {
    harness,
    store,
    project,
    entriesOf,
    childrenOf,
    until,
    conversationOf,
    async toolOutputs(id: string): Promise<string> {
      const results = (await entriesOf(id)).filter((entry) => entry.kind === "pi.tool-result");
      return results.map((entry) => JSON.stringify(entry.model)).join("\n");
    },
    notificationsOf: async (id: string) =>
      (await entriesOf(id)).filter((entry) => entry.kind === SUBAGENT_NOTIFICATION_KIND),
    async start(text: string, requestId = `r-${Math.random()}`) {
      const { summary } = await store.start({
        project,
        model: FAUX,
        thinkingLevel: "off",
        input: { text, requestId },
        workspace: legacyWorkspace(project.path),
        now: Date.now(),
      });
      return summary;
    },
    async idle(id: string) {
      await (await conversationOf(id))?.waitForIdle(BACKGROUND);
    },
    async firstChild(parentId: string) {
      await until(async () => (await childrenOf(parentId)).length > 0);
      return (await childrenOf(parentId))[0]!;
    },
    async notified(parentId: string, count = 1) {
      await until(async () => (await this.notificationsOf(parentId)).length >= count);
      return this.notificationsOf(parentId);
    },
    close: () => harness.close(BACKGROUND),
  };
}

export type Rig = Awaited<ReturnType<typeof openRig>>;
