import {
  baseOps,
  type ConversationSummary,
  type ConversationView,
  type ConversationWatcher,
  type InboxState,
  type ModelRef,
  type Op,
  type OpsListener,
} from "@pi-everywhere/protocol";
import { fixtureForMessage, triggerOf } from "../fixtures/triggers";
import type { Fixture } from "../fixtures/types";
import { fixtureViews } from "../fixtures/views";
import { diffViews, emptyView, inboxOf, rebase, substituteText, withInbox, withoutRun } from "./replay";

export interface FakeConversationDeps {
  readonly id: string;
  readonly projectId: string;
  readonly cwd: string;
  readonly model: ModelRef;
  readonly speed: number;
  readonly now: () => number;
  readonly onSummaryChange: (projectId: string) => void;
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

const TITLE_LENGTH = 60;

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line;
}

export class FakeConversation {
  readonly id: string;
  readonly projectId: string;
  readonly createdAt: number;
  title = "";
  updatedAt: number;
  private view: ConversationView;
  private readonly watchers = new Set<Watcher>();
  private readonly requestIds = new Set<string>();
  private queued: string[] = [];
  private playback: Playback | undefined;
  private titleLocked = false;
  private nextSubmissionId = 1000;

  constructor(private readonly deps: FakeConversationDeps) {
    this.id = deps.id;
    this.projectId = deps.projectId;
    this.createdAt = deps.now();
    this.updatedAt = this.createdAt;
    this.view = emptyView(Number(deps.id), deps.cwd, deps.model);
  }

  summary(): ConversationSummary {
    return {
      id: this.id,
      projectId: this.projectId,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  isBusy(): boolean {
    return this.playback !== undefined;
  }

  rename(title: string): void {
    this.title = title;
    this.titleLocked = true;
    this.touch();
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

  send(requestId: string, text: string): void {
    if (this.requestIds.has(requestId)) return;
    this.requestIds.add(requestId);
    this.updatedAt = this.deps.now();
    if (!this.titleLocked && this.title === "") this.title = titleFrom(text);
    this.deps.onSummaryChange(this.projectId);
    if (!this.playback) {
      void this.playAll(text);
    } else if (!this.consumeScriptedSend(text)) {
      this.queued.push(text);
      this.publish(this.view);
    }
  }

  async abort(): Promise<void> {
    if (this.playback) this.playback.cancelled = true;
    this.playback = undefined;
    this.queued = [];
    this.publish(withoutRun(this.view));
  }

  stop(): void {
    if (this.playback) this.playback.cancelled = true;
    this.playback = undefined;
    for (const watcher of this.watchers) watcher.stopped = true;
    this.watchers.clear();
  }

  private touch(): void {
    this.updatedAt = this.deps.now();
    this.deps.onSummaryChange(this.projectId);
  }

  private consumeScriptedSend(text: string): boolean {
    const scripted = this.playback?.scriptedSends ?? [];
    const index = scripted.indexOf(text);
    if (index < 0) return false;
    scripted.splice(index, 1);
    return true;
  }

  private queuedInbox(): InboxState["items"] {
    return this.queued.map((content, index) => ({
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

  private async playAll(firstText: string): Promise<void> {
    let text: string | undefined = firstText;
    while (text !== undefined) {
      const finished = await this.play(text);
      if (!finished) return;
      text = this.queued.shift();
    }
    this.playback = undefined;
    this.touch();
  }

  private async play(text: string): Promise<boolean> {
    const fixture = fixtureForMessage(text);
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
      this.publish(substituteText(rebase(base, fixtureView), triggerOf(fixture) ?? "", text));
    }
    return !playback.cancelled;
  }
}

function scriptedSendsOf(fixture: Fixture): string[] {
  return fixture.steps.slice(1).flatMap((step) => (step.kind === "send" ? [step.text] : []));
}

function sleep(ms: number): Promise<void> {
  return ms < 1 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
