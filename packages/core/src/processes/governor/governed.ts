import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ResourcePriority, ResourceScope, ResourceSettings, SandboxSettings } from "@tau/protocol";
import { ConversationDoc, type IndexedConversation, ProjectIndexDoc } from "../../harness/conversation-docs";
import { anyControlOn } from "./resource-state";

export type ThreadClass = ResourceScope;

/** Subagent by `parentId`, else worktree by workspace mode, else main. */
export function classifyThread(entry: Pick<IndexedConversation, "parentId" | "workspace">): ThreadClass {
  if (entry.parentId !== undefined && entry.parentId !== null) return "subagent";
  return (entry.workspace?.mode ?? "checkout") === "worktree" ? "worktree" : "main";
}

export const levelOf = (settings: ResourceSettings, thread: ThreadClass): ResourcePriority =>
  settings.levels[thread];

export const anyScopeOn = (settings: ResourceSettings) =>
  settings.levels.main !== "off" || settings.levels.worktree !== "off" || settings.levels.subagent !== "off";

const resourceControlApplies = (settings: ResourceSettings) => anyControlOn(settings) && anyScopeOn(settings);

export const anySandboxOn = (settings: SandboxSettings) =>
  settings.main || settings.worktree || settings.subagent;

/** The thread's class, or `undefined` when the lookup found nothing or the thread is deleted. */
const knownThreadClass = (entry: IndexedConversation | undefined): ThreadClass | undefined =>
  entry && entry.deletedAt === undefined ? classifyThread(entry) : undefined;

const governedScopeOf = (settings: ResourceSettings, thread: ThreadClass | undefined) =>
  thread !== undefined && levelOf(settings, thread) !== "off" ? thread : undefined;

/** The security scope of a spawn: the thread's class, or `unknown` when it cannot be resolved (never assumed `main`). */
export type SandboxScope = ThreadClass | "unknown";

/**
 * The calling thread's scopes, resolved with at most one lookup.
 * `governedScope` is set only while resource control applies to the thread (selects CPU and memory governing).
 * `sandboxScope` is set whenever the sandbox is on for any scope (selects the sandbox policy), whatever the
 * resource level; an unknown or deleted thread is `unknown`, which the process service treats fail-closed.
 */
export interface CallScopes {
  readonly governedScope?: ThreadClass;
  readonly sandboxScope?: SandboxScope;
}

/** `find` is not called unless resource control or the sandbox is on for at least one scope. */
export async function callScopes(
  resource: ResourceSettings,
  sandbox: SandboxSettings,
  find: () => Promise<IndexedConversation | undefined>,
): Promise<CallScopes> {
  const needsResource = resourceControlApplies(resource);
  const needsSandbox = anySandboxOn(sandbox);
  if (!needsResource && !needsSandbox) return {};
  const thread = knownThreadClass(await find().catch(() => undefined));
  const governedScope = needsResource ? governedScopeOf(resource, thread) : undefined;
  return {
    ...(governedScope && { governedScope }),
    ...(needsSandbox && { sandboxScope: thread ?? "unknown" }),
  };
}

/** The request fields for a spawn: governor scope and sandbox scope stay separate. */
export function scopeFields({ governedScope, sandboxScope }: CallScopes) {
  return {
    ...(governedScope && { governed: true as const, scope: governedScope }),
    ...(sandboxScope && { sandboxScope }),
  };
}

/**
 * The calling thread's scope when resource control applies to it, else `undefined`.
 * `find` is not called unless a control is on for at least one scope. Unknown or deleted is ungoverned.
 */
export async function governedScope(
  settings: ResourceSettings,
  find: () => Promise<IndexedConversation | undefined>,
): Promise<ThreadClass | undefined> {
  if (!resourceControlApplies(settings)) return undefined;
  return governedScopeOf(settings, knownThreadClass(await find().catch(() => undefined)));
}

/** `find` is not called unless a control is on for at least one scope. Unknown or deleted is ungoverned. */
export async function isGoverned(
  settings: ResourceSettings,
  find: () => Promise<IndexedConversation | undefined>,
): Promise<boolean> {
  return (await governedScope(settings, find)) !== undefined;
}

/** The calling thread's entry in its project index. */
export function indexEntryOfCall(api: ToolExecutionApi, context: Context) {
  return async (): Promise<IndexedConversation | undefined> => {
    const meta = await api.snapshot(ConversationDoc, api.conversationId, context);
    if (!meta?.projectId) return undefined;
    const index = await api.snapshot(ProjectIndexDoc, meta.projectId, context);
    const id = Number(api.conversationId);
    return index?.conversations.find((entry) => entry.conversationId === id);
  };
}
