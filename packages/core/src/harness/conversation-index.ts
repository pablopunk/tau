import type { ConversationId, Cursor, Harness } from "@earendil-works/pi-durable";
import type { ConversationSummary, ThreadWorkspace } from "@pi-everywhere/protocol";
import {
  ConversationDoc,
  type ConversationMeta,
  INDEX_SEED,
  type IndexedConversation,
  ProjectIndexDoc,
} from "./conversation-docs";
import { BACKGROUND } from "./open";

export type ProjectRef = { readonly id: string; readonly path: string };

export const legacyWorkspace = (projectPath: string): ThreadWorkspace => ({
  mode: "checkout",
  path: projectPath,
  branch: null,
  base: null,
  state: "ready",
  mergedSha: null,
  pullRequestUrl: null,
});

export const toSummary = (project: ProjectRef, entry: IndexedConversation): ConversationSummary => ({
  id: String(entry.conversationId),
  projectId: project.id,
  title: entry.title,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
  archivedAt: entry.archivedAt ?? null,
  status: entry.status ?? "idle",
  lastRunEndedAt: entry.lastRunEndedAt ?? null,
  avatarIndex: entry.conversationId,
  lastActivityAt: entry.lastRunEndedAt ?? entry.updatedAt,
  model: entry.model ?? null,
  workspace: entry.workspace ?? legacyWorkspace(project.path),
  forkOf: entry.forkOf ?? null,
  parentId: entry.parentId ?? null,
});

export const byMostRecentlyUpdated = (a: ConversationSummary, b: ConversationSummary) =>
  b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id);

export const isLive = (entry: IndexedConversation) => entry.deletedAt === undefined;

export async function indexOf(harness: Harness, projectId: string): Promise<IndexedConversation[]> {
  return [...((await harness.snapshot(ProjectIndexDoc, projectId, BACKGROUND))?.conversations ?? [])];
}

/** Undefined for ids that never had an `app.conversation` document, such as subagent children. */
export function readMeta(harness: Harness, id: ConversationId) {
  return harness.snapshot(ConversationDoc, id, BACKGROUND).catch(() => undefined);
}

export type LiveChange = (meta: ConversationMeta, entry: IndexedConversation) => boolean | undefined;

/**
 * The one writer of a conversation's document and index entry. It reads `app.conversation` inside the commit and
 * does nothing for a tombstoned thread, so no writer can undo a delete. Returns whether `change` applied.
 */
export function updateLiveConversation(
  harness: Harness,
  id: ConversationId,
  projectId: string,
  change: LiveChange,
): Promise<boolean> {
  return harness.commit(async (tx) => {
    const meta = await tx.doc(ConversationDoc, id);
    if (meta.deletedAt !== undefined) return false;
    const index = await tx.doc(ProjectIndexDoc, projectId, INDEX_SEED);
    const entry = index.conversations.find((candidate) => candidate.conversationId === Number(id));
    if (!entry || entry.deletedAt !== undefined) return false;
    return change(meta, entry) !== false;
  }, BACKGROUND);
}

export type AppConversation = { id: ConversationId; meta: Readonly<ConversationMeta> };

/** Every conversation that has an `app.conversation` document (subagent children have none). */
export async function scanAppConversations(harness: Harness): Promise<AppConversation[]> {
  const found: AppConversation[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await harness.commit((tx) => tx.scanConversations({}, 200, cursor), BACKGROUND);
    for (const record of page.items) {
      const meta = await readMeta(harness, record.id);
      if (meta) found.push({ id: record.id, meta });
    }
    cursor = page.next;
  } while (cursor !== undefined);
  return found;
}
