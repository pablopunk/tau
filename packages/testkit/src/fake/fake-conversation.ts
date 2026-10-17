import {
  AppError,
  baseOps,
  type ConversationStatus,
  type ConversationSummary,
  type ConversationView,
  type ConversationWatcher,
  type ImageInput,
  type InboxState,
  isRetryable,
  type ModelRef,
  type Op,
  type OpsListener,
  RETIRED_OPS,
  type ThinkingLevel,
  type UserMessage,
} from "@pi-everywhere/protocol";
import { fixtures } from "../fixtures/index";
import { fixtureForMessage, triggerOf } from "../fixtures/triggers";
import type { Fixture } from "../fixtures/types";
import { fixtureViews } from "../fixtures/views";
import {
  diffViews,
  emptyView,
  inboxOf,
  lastAssistantFailed,
  rebase,
  restyleNewUserEntries,
  substituteText,
  withInbox,
  withoutRun,
} from "./replay";

export const RETRY_PROMPT = "The previous attempt failed or was stopped. Continue.";

export interface FakeConversationDeps {
  readonly id: string;
  readonly projectId: string;
  readonly cwd: string;
  readonly model: ModelRef;
  readonly thinkingLevel: ThinkingLevel;
  readonly speed: number;
  readonly now: () => number;
  readonly onSummaryChange: (projectId: string) => void;
  /** The name the title job comes up with, or `undefined` when it fails. */
  readonly generateTitle: (text: string) => string | undefined;
}

export interface FakeInput {
  readonly text: string;
  readonly images?: readonly ImageInput[];
}

interface Watcher {
  readonly listener: OpsListener;
  chain: Promise<void>;
  stopped: boolean;
}

interface Playback {
  cancelled: boolean;
  scriptedSends: string[];
}

interface QueuedInput {
  readonly input: FakeInput;
  readonly content: UserMessage["content"];
}

const MIN_ANSWERS_TO_COMPACT = 2;
const TITLE_LENGTH = 60;
const IMAGE_TITLE = "Image";
const TITLE_JOB_DELAY_MS = 40;

type TitleSource = "first-message" | "generated" | "user";

function titleFrom(input: FakeInput): string {
  const line = input.text.trim().split("\n")[0] ?? "";
  if (line === "") return IMAGE_TITLE;
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line;
}

function contentOf(input: FakeInput): UserMessage["content"] {
  if (!input.images?.length) return input.text;
  const text = input.text.trim() === "" ? [] : [{ type: "text" as const, text: input.text }];
  return [...text, ...input.images.map((image) => ({ type: "image" as const, ...image }))];
}

export class FakeConversation {
  readonly id: string;
  readonly projectId: string;
  readonly createdAt: number;
  title = "";
  updatedAt: number;
  archivedAt: number | null = null;
  lastRunEndedAt: number | null = null;
  private deleted = false;
  private failed = false;
  private titleSource: TitleSource = "first-message";
  private titleTimer: ReturnType<typeof setTimeout> | undefined;
  private view: ConversationView;
  private readonly watchers = new Set<Watcher>();
  private readonly requestIds = new Set<string>();
  private queued: QueuedInput[] = [];
  private playback: Playback | undefined;
  private nextSubmissionId = 1000;

  constructor(private readonly deps: FakeConversationDeps) {
    this.id = deps.id;
    this.projectId = deps.projectId;
    this.createdAt = deps.now();
    this.updatedAt = this.createdAt;
    this.view = emptyView(Number(deps.id), deps.cwd, deps.model, deps.thinkingLevel);
  }

  get model(): ModelRef {
    return this.agent().model;
  }

  configure(model: ModelRef, thinkingLevel: ThinkingLevel): void {
    const agent = {
      ...this.agent(),
      model: { provider: model.provider, modelId: model.modelId },
      thinkingLevel,
    };
    this.publish({
      ...this.view,
      docs: { ...this.view.docs, "pi.agent": agent },
    } as unknown as ConversationView);
  }

  hasHistoryToCompact(): boolean {
    return (
      this.view.entries.filter((entry) => entry.kind === "pi.assistant").length >= MIN_ANSWERS_TO_COMPACT
    );
  }

  thinkingLevel(): ThinkingLevel {
    return this.agent().thinkingLevel;
  }

  private agent(): { model: ModelRef; cwd: string; thinkingLevel: ThinkingLevel } {
    return this.view.docs["pi.agent"] as unknown as {
      model: ModelRef;
      cwd: string;
      thinkingLevel: ThinkingLevel;
    };
  }

  get isDeleted(): boolean {
    return this.deleted;
  }

  summary(): ConversationSummary {
    return {
      id: this.id,
      projectId: this.projectId,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      archivedAt: this.archivedAt,
      status: this.status(),
      lastRunEndedAt: this.lastRunEndedAt,
      avatarIndex: Number(this.id),
      lastActivityAt: this.lastRunEndedAt ?? this.updatedAt,
      model: { provider: this.model.provider, modelId: this.model.modelId },
    };
  }

  isBusy(): boolean {
    return this.playback !== undefined;
  }

  hasRequest(requestId: string): boolean {
    return this.requestIds.has(requestId);
  }

  rename(title: string): void {
    this.title = title;
    this.titleSource = "user";
    this.touch();
  }

  archive(archived: boolean): void {
    this.archivedAt = archived ? this.deps.now() : null;
    this.deps.onSummaryChange(this.projectId);
  }

  watch(listener: OpsListener): ConversationWatcher {
    const watcher: Watcher = { listener, chain: Promise.resolve(), stopped: false };
    this.watchers.add(watcher);
    this.deliver(watcher, baseOps(this.view));
    return {
      stop: async () => {
        watcher.stopped = true;
        this.watchers.delete(watcher);
        await watcher.chain;
      },
    };
  }

  send(requestId: string, input: FakeInput): void {
    if (this.requestIds.has(requestId)) return;
    this.requestIds.add(requestId);
    this.archivedAt = null;
    this.updatedAt = this.deps.now();
    this.nameFromFirstMessage(input);
    this.admit({ input, content: contentOf(input) }, undefined);
  }

  retry(requestId: string): void {
    if (this.requestIds.has(requestId)) return;
    if (this.isBusy() || !isRetryable(this.view)) {
      throw new AppError("invalid_request", "There is nothing to retry.");
    }
    this.requestIds.add(requestId);
    this.archivedAt = null;
    this.updatedAt = this.deps.now();
    this.admit({ input: { text: RETRY_PROMPT }, content: RETRY_PROMPT }, "app.retry");
  }

  async abort(): Promise<void> {
    const wasRunning = this.playback !== undefined;
    if (this.playback) this.playback.cancelled = true;
    this.playback = undefined;
    this.queued = [];
    this.publish(withoutRun(this.view));
    if (wasRunning) this.endRun(false);
  }

  remove(): void {
    this.deleted = true;
    this.cancelWork();
    for (const watcher of this.watchers) {
      this.deliver(watcher, RETIRED_OPS);
      watcher.chain = watcher.chain.then(() => {
        watcher.stopped = true;
      });
    }
    this.watchers.clear();
  }

  stop(): void {
    this.cancelWork();
    for (const watcher of this.watchers) watcher.stopped = true;
    this.watchers.clear();
  }

  private cancelWork(): void {
    if (this.playback) this.playback.cancelled = true;
    this.playback = undefined;
    this.queued = [];
    clearTimeout(this.titleTimer);
  }

  private status(): ConversationStatus {
    if (this.playback) return "running";
    return this.failed ? "error" : "idle";
  }

  private nameFromFirstMessage(input: FakeInput): void {
    if (this.title !== "") return;
    this.title = titleFrom(input);
    if (input.text.trim() === "") return;
    this.titleTimer = setTimeout(() => this.applyGeneratedTitle(input.text), TITLE_JOB_DELAY_MS);
  }

  private applyGeneratedTitle(text: string): void {
    const generated = this.deps.generateTitle(text);
    if (this.deleted || this.titleSource !== "first-message" || generated === undefined) return;
    this.title = generated;
    this.titleSource = "generated";
    this.deps.onSummaryChange(this.projectId);
  }

  private admit(queued: QueuedInput, entryKind: string | undefined): void {
    this.deps.onSummaryChange(this.projectId);
    if (!this.playback) {
      this.failed = false;
      void this.playAll(queued, entryKind);
    } else if (!this.consumeScriptedSend(queued.input.text)) {
      this.queued.push(queued);
      this.publish(this.view);
    }
  }

  private touch(): void {
    this.updatedAt = this.deps.now();
    this.deps.onSummaryChange(this.projectId);
  }

  private endRun(failed: boolean): void {
    this.failed = failed;
    this.lastRunEndedAt = this.deps.now();
    this.touch();
  }

  private consumeScriptedSend(text: string): boolean {
    const scripted = this.playback?.scriptedSends ?? [];
    const index = scripted.indexOf(text);
    if (index < 0) return false;
    scripted.splice(index, 1);
    return true;
  }

  private queuedInbox(): InboxState["items"] {
    return this.queued.map(({ content }, index) => ({
      id: this.nextSubmissionId + index,
      mode: "steer",
      content,
    })) as unknown as InboxState["items"];
  }

  private publish(next: ConversationView): void {
    const withQueue = withInbox(next, [...inboxOf(next), ...this.queuedInbox()]);
    const ops = diffViews(this.view, withQueue);
    if (ops.length === 0) return;
    this.view = withQueue;
    for (const watcher of this.watchers) this.deliver(watcher, ops);
  }

  private deliver(watcher: Watcher, ops: readonly Op[]): void {
    watcher.chain = watcher.chain
      .then(() => (watcher.stopped ? undefined : watcher.listener(ops)))
      .catch(() => undefined);
  }

  private async playAll(first: QueuedInput, entryKind: string | undefined): Promise<void> {
    let next: QueuedInput | undefined = first;
    let kind = entryKind;
    while (next !== undefined) {
      const finished = await this.play(next, kind);
      if (!finished) return;
      next = this.queued.shift();
      kind = undefined;
    }
    this.playback = undefined;
    this.endRun(lastAssistantFailed(this.view));
  }

  private async play({ input, content }: QueuedInput, entryKind: string | undefined): Promise<boolean> {
    const fixture = entryKind ? fixtures.text : fixtureForMessage(input.text);
    const playback: Playback = { cancelled: false, scriptedSends: scriptedSendsOf(fixture) };
    this.playback = playback;
    const base = this.view;
    const views = fixtureViews(fixture);
    let previousAt = 0;
    for (let index = 1; index < fixture.frames.length; index++) {
      const frame = fixture.frames[index];
      const fixtureView = views[index];
      if (!frame || !fixtureView) continue;
      await sleep((frame.at - previousAt) / this.deps.speed);
      if (playback.cancelled) return false;
      previousAt = frame.at;
      this.publish(this.replayed(fixture, base, fixtureView, { input, content }, entryKind));
    }
    return !playback.cancelled;
  }

  private replayed(
    fixture: Fixture,
    base: ConversationView,
    fixtureView: ConversationView,
    { input, content }: QueuedInput,
    entryKind: string | undefined,
  ): ConversationView {
    const substituted = substituteText(rebase(base, fixtureView), triggerOf(fixture) ?? "", input.text);
    const restyled = restyleNewUserEntries(substituted, base, { content, kind: entryKind });
    return fixture.name === "image" ? withImageCount(restyled, input.images?.length ?? 0) : restyled;
  }
}

function withImageCount(view: ConversationView, count: number): ConversationView {
  return JSON.parse(
    JSON.stringify(view).replace("Images received: 1", `Images received: ${count}`),
  ) as ConversationView;
}

function scriptedSendsOf(fixture: Fixture): string[] {
  return fixture.steps.slice(1).flatMap((step) => (step.kind === "send" ? [step.text] : []));
}

function sleep(ms: number): Promise<void> {
  return ms < 1 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
