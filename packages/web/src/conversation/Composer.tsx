import type { FileRef, ImageInput, TranscribeInput, WhenBusy } from "@tau/protocol";
import { ArrowUp, Keyboard, Mic, Paperclip, Square } from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { DropZone } from "@/components/ui/drop-zone";
import { Input } from "@/components/ui/input";
import { type MentionItem, MentionMenu } from "@/components/ui/mention-menu";
import { AnimatePresence, fade, gentle, motion, rise } from "@/components/ui/motion";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scopeTarget } from "@/lib/node-keys";
import { useApprovals, useSettings } from "@/lib/queries";
import { markAction, markConfirm } from "@/lib/timings";
import { cn } from "@/lib/utils";
import { useApi, useNodeId } from "@/nodes/node-context";
import { AttachmentRow } from "./composer/AttachmentRow";
import { BANG_EMPTY_ERROR, isBangMode, isBareBang } from "./composer/bang-mode";
import { loadDraft, saveDraft } from "./composer/drafts";
import { applyMention } from "./composer/mentions";
import { menuKeyAction } from "./composer/menu-keys";
import { onComposerRestore } from "./composer/restore";
import { type CommandHandlers, type CommandName, parseSlashCommand } from "./composer/slash-commands";
import { commandItemId, useComposerMenu } from "./composer/use-composer-menu";
import { useDictation } from "./composer/use-dictation";
import { insertionOf } from "./composer/use-mention-items";
import { usePageDrag } from "./composer/use-page-drop";
import { loadFileAttachments } from "./files/attachments";
import { useFileAttachments } from "./files/use-file-attachments";
import { loadAttachments } from "./images/attachments";
import { useAttachments } from "./images/use-attachments";
import { hasReceipt } from "./queue/pending-sends";

export interface ComposerProps {
  /** Draft key: `"new"` for the new thread page, the conversation id in a thread. */
  target: "new" | string;
  imagesAllowed: boolean;
  busy?: boolean;
  /** Sending is blocked, e.g. while the project is cloning. */
  disabled?: boolean;
  /** Why sending is blocked, shown under the input box while `disabled`. */
  disabledReason?: string;
  /** Rendered under the input box, e.g. the project picker. */
  footer?: ReactNode;
  /** Rendered inside the input box next to the stop button, e.g. the busy key hint. */
  hint?: ReactNode;
  /** Rendered inside the input box toolbar after the attach button, e.g. model and thinking. */
  toolbar?: ReactNode;
  /** Rendered at the start of the toolbar, before `toolbar`. */
  toolbarStart?: ReactNode;
  /** Rendered above the input box, e.g. the todo panel. */
  abovePanel?: ReactNode;
  /** Why files cannot be attached here (e.g. an engine without attachments); omitted when they can. */
  attachmentsBlockedReason?: string;
  /** Only follow-up delivery exists: no steer, no Alt+Enter mode switch. */
  followUpOnly?: boolean;
  /** Delivery mode used while busy; Alt+Enter sends with the other one. Omitted: the server default. */
  whenBusy?: WhenBusy;
  /** Slash commands the menu offers; a command without a handler is hidden. */
  commands?: CommandHandlers;
  /** Project searched by `@` mentions; without it only skills of the user are offered. */
  projectId?: string | null;
  onSend(input: {
    text: string;
    images: ImageInput[];
    files: FileRef[];
    whenBusy?: WhenBusy;
    // `unknown`: sends resolve receipts, the new-thread start path resolves
    // nothing, and pre-contract nodes resolve `void` — call sites narrow
    // with `hasReceipt`.
  }): Promise<unknown>;
  onStop?(): Promise<void>;
  /** Called right after a message is handed to `onSend`, e.g. to scroll to it. */
  onSent?(): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach the server.";
}

function isPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

const placeholderOf = (busy: boolean, mode: WhenBusy = "steer") =>
  !busy
    ? "Message the agent…"
    : mode === "followUp"
      ? "Queue a message…"
      : "Steer at the next tool boundary…";

/** Mode-reflecting send label: never "Send as steer" while queueing. */
const sendLabelOf = (busy: boolean, mode: WhenBusy = "steer") =>
  !busy ? "Send" : mode === "followUp" ? "Queue message" : "Send as steer";

const otherMode = (mode: WhenBusy = "steer"): WhenBusy => (mode === "steer" ? "followUp" : "steer");

function pastedFiles(event: ClipboardEvent): File[] {
  return Array.from(event.clipboardData.files);
}

function ComposerForm({
  target: threadTarget,
  imagesAllowed,
  busy = false,
  disabled = false,
  disabledReason,
  footer,
  hint,
  toolbar,
  toolbarStart,
  abovePanel,
  whenBusy,
  attachmentsBlockedReason,
  followUpOnly = false,
  commands = {},
  projectId,
  onSend,
  onStop,
  onSent,
}: ComposerProps) {
  const target = scopeTarget(threadTarget, useNodeId());
  const [text, setTextState] = useState(() => loadDraft(target));
  // Touch devices get a four-button row (attach, keyboard, dictate, send)
  // instead of the desktop field + toolbar; keyboard and dictate run big.
  // Pointer type never changes on resize, so read it once per mount.
  const [coarse] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches,
  );
  const [showInput, setShowInput] = useState(false);
  const [error, setError] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingThread = useRef(false);
  const draftLocked = starting || (threadTarget === "new" && busy && disabled);
  const picker = useRef<HTMLInputElement>(null);
  const { attachments, preparing, addFiles, remove, replace } = useAttachments(target, imagesAllowed);
  const {
    files: fileAttachments,
    staging: stagingFiles,
    stageFiles,
    remove: removeFile,
    replace: replaceFiles,
  } = useFileAttachments(target);
  const attachmentsBlocked = attachmentsBlockedReason !== undefined;
  const [pageDragging, endPageDrag] = usePageDrag(!attachmentsBlocked && !draftLocked);
  const [caret, setCaret] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pastedText, setPastedText] = useState<string | null>(null);
  const pasting = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useComposerMenu({ text, caret, commands, projectId, pastedText });
  const bangMode = isBangMode(text);
  // While approval is pending the composer yields to the approval bar: no
  // steer affordance (a steer would wait for the post-approval boundary
  // anyway), queue-only sends, and copy that never implies immediacy.
  // `threadTarget` (not the node-scoped draft key): approvals live per conversation.
  const approvals = useApprovals(threadTarget, threadTarget !== "new");
  const approvalPending = (approvals.data?.length ?? 0) > 0;
  const queueOnly = approvalPending || followUpOnly;
  const effectiveMode = queueOnly ? ("followUp" as const) : whenBusy;
  const hasStagedFiles = attachments.length > 0 || fileAttachments.length > 0;
  const canSend =
    (text.trim().length > 0 || hasStagedFiles) &&
    !(attachmentsBlocked && hasStagedFiles) &&
    !preparing &&
    !stagingFiles &&
    !disabled &&
    !draftLocked;

  /** Images stay on the vision path; everything else stages as a generic file, even when the model disallows images. */
  const addSelection = (selection: File[]) => {
    if (selection.length === 0 || startingThread.current) return;
    if (attachmentsBlockedReason !== undefined) return setError(attachmentsBlockedReason);
    const images = selection.filter((file) => file.type.startsWith("image/"));
    const rest = selection.filter((file) => !file.type.startsWith("image/"));
    if (images.length > 0) addFiles(images);
    if (rest.length > 0) void stageFiles(rest);
  };

  useEffect(() => {
    // Never steal focus on touch devices: it pops the keyboard and iOS
    // scrolls the page, pushing the header off-screen with no way back.
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.closest("[role=dialog]")) return;
    textarea.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (showInput) textarea.current?.focus({ preventScroll: true });
  }, [showInput]);

  useEffect(
    () =>
      onComposerRestore(target, () => {
        if (startingThread.current) return;
        setTextState(loadDraft(target));
        replace(loadAttachments(target));
        replaceFiles(loadFileAttachments(target));
        if (window.matchMedia?.("(pointer: coarse)").matches) return;
        requestAnimationFrame(() => textarea.current?.focus());
      }),
    [target, replace, replaceFiles],
  );

  const setText = useCallback(
    (value: string) => {
      saveDraft(target, value);
      setTextState(value);
    },
    [target],
  );

  const textRef = useRef(text);
  textRef.current = text;
  const appendDictation = useCallback(
    (transcript: string) => {
      const clean = transcript.replace(/\s+/g, " ").trim();
      if (!clean || startingThread.current) return;
      setShowInput(true);
      const base = textRef.current.replace(/\s+$/, "");
      setText(base ? `${base} ${clean} ` : `${clean} `);
    },
    [setText],
  );
  // The voice setting lives on the thread's node: transcribe through the
  // same api instance the row saves with, so node switches can't split them.
  const api = useApi();
  const settings = useSettings();
  const voiceModel = settings.data?.voiceModel ?? null;
  const transcribe = useCallback((input: TranscribeInput) => api.voice.transcribe(input), [api]);
  const warm = useCallback(() => api.voice.warm(), [api]);
  const dictation = useDictation(
    appendDictation,
    setError,
    voiceModel ? { setting: voiceModel, transcribe, warm } : null,
  );

  const runCommand = (name: CommandName, args: string) => {
    if (startingThread.current) return;
    setText("");
    setError(undefined);
    Promise.resolve(commands[name]?.(args)).catch((failure: unknown) => setError(errorText(failure)));
  };

  const insertMention = (insertion: string) => {
    if (!menu.mention) return;
    const next = applyMention(text, menu.mention, caret, insertion);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => textarea.current?.setSelectionRange(next.caret, next.caret));
  };

  const pick = (item: MentionItem) => {
    if (item.disabled || startingThread.current) return;
    if (!item.id.startsWith(commandItemId(""))) return insertMention(insertionOf(item.id));
    const name = insertionOf(item.id) as CommandName;
    if (name === "compact" || name === "goal" || name === "loop") return setText(`/${name} `);
    runCommand(name, "");
  };

  const submit = (mode: WhenBusy | undefined = effectiveMode) => {
    const command = parseSlashCommand(text);
    if (command && commands[command.name]) return runCommand(command.name, command.args);
    if (isBareBang(text)) {
      setError(BANG_EMPTY_ERROR);
      return;
    }
    const message = text.trim();
    const sent = attachments;
    const sentFiles = fileAttachments;
    if (!canSend || startingThread.current) return;
    const trackInTranscript = threadTarget !== "new";
    if (!trackInTranscript) {
      startingThread.current = true;
      setStarting(true);
    }
    // Approval pending: a steer would wait for the post-approval boundary anyway — queue it.
    const sendMode = queueOnly ? ("followUp" as const) : mode;
    const outgoing = {
      text: message,
      images: sent.map((item) => item.image),
      files: sentFiles.map((item) => item.ref),
      ...(busy && sendMode && { whenBusy: sendMode }),
    };
    const token = markAction("send");
    if (trackInTranscript) {
      setText("");
      replace([]);
      replaceFiles([]);
    }
    setError(undefined);
    const sending = onSend(outgoing);
    onSent?.();
    void sending
      .then(
        (receipt) => {
          if (!trackInTranscript) {
            setText("");
            replace([]);
            replaceFiles([]);
          }
          // The pending bubble is registered at tap by the send action and settles
          // itself on the receipt: this only records the confirm timing.
          if (trackInTranscript && hasReceipt(receipt)) markConfirm(token, receipt, busy ? "queued" : "sent");
        },
        (failure: unknown) => {
          // In a thread the send action already turned its bubble into a failed
          // one with retry. A new thread has no transcript yet: put everything
          // back so nothing is silently lost (a stale ref rejects `file_expired`).
          if (!trackInTranscript) {
            setText(message);
            replace(sent);
            replaceFiles(sentFiles);
          }
          setError(errorText(failure));
        },
      )
      .finally(() => {
        startingThread.current = false;
        setStarting(false);
      });
  };

  const stop = () => {
    if (!onStop) return;
    setStopping(true);
    onStop()
      .catch((failure: unknown) => setError(errorText(failure)))
      .finally(() => setStopping(false));
  };

  const onMenuKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const action = menuKeyAction(event, menu.open);
    if (!action) return false;
    event.preventDefault();
    if (action === "next") menu.move(1);
    if (action === "previous") menu.move(-1);
    if (action === "close") menu.close();
    const item = menu.activeItem();
    if (action === "pick" && item) pick(item);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onMenuKey(event)) return;
    // Escape never aborts the run: one mis-key must not kill the run and the queue.
    if (!isPlainEnter(event)) return;
    event.preventDefault();
    // Approval pending hides the steer affordance: Alt+Enter queues too.
    submit(
      queueOnly ? ("followUp" as const) : event.altKey || event.metaKey ? otherMode(whenBusy) : whenBusy,
    );
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (startingThread.current) return;
    setCaret(event.target.selectionStart);
    if (pasting.current) setPastedText(event.target.value);
    pasting.current = false;
    setText(event.target.value);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (startingThread.current) {
      event.preventDefault();
      return;
    }
    const files = pastedFiles(event).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      pasting.current = true;
      return;
    }
    event.preventDefault();
    if (attachmentsBlockedReason !== undefined) return setError(attachmentsBlockedReason);
    addFiles(files);
  };

  const onPicked = (files: FileList | null) => {
    addSelection(Array.from(files ?? []));
    if (picker.current) picker.current.value = "";
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <AnimatePresence initial={false}>
        {abovePanel ? (
          <motion.div key="above-panel" {...rise} transition={gentle}>
            {abovePanel}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {pageDragging ? (
        <DropZone
          className="fixed inset-0 z-50"
          onFiles={(dropped) => {
            endPageDrag();
            addSelection(dropped);
          }}
        >
          <span className="sr-only">Drop files to attach</span>
        </DropZone>
      ) : null}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="error"
            role="alert"
            {...fade}
            transition={gentle}
            className="text-sm text-destructive"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <MentionMenu
        open={menu.open && !draftLocked}
        items={menu.items}
        activeIndex={menu.activeIndex}
        onActiveIndexChange={menu.setActiveIndex}
        onSelect={pick}
        onClose={menu.close}
        emptyText="No matches"
        anchor={anchor}
      />
      <div
        ref={setAnchor}
        className={cn(
          "relative rounded-2xl border bg-card p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          bangMode &&
            "border-destructive/50 focus-within:border-destructive focus-within:ring-destructive/20",
          dictation.listening && "border-primary/60",
        )}
      >
        <div
          aria-hidden
          ref={dictation.glowRef}
          data-testid="dictation-glow"
          className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-150"
        />
        <AttachmentRow
          attachments={attachments}
          disabled={draftLocked}
          onRemove={(id) => {
            if (!startingThread.current) remove(id);
          }}
          files={fileAttachments}
          onRemoveFile={(id) => {
            if (!startingThread.current) removeFile(id);
          }}
        />
        {bangMode ? (
          <span
            aria-hidden="true"
            data-testid="bang-prompt"
            className="pointer-events-none absolute top-2 left-3 py-1.5 font-mono text-sm text-destructive select-none"
          >
            $
          </span>
        ) : null}
        <Textarea
          ref={textarea}
          aria-label="Message"
          readOnly={draftLocked}
          value={text}
          onChange={onChange}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={bangMode && !busy ? "Run a shell command…" : placeholderOf(busy, effectiveMode)}
          rows={1}
          className={cn(
            "max-h-48 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent",
            bangMode && "pl-7 font-mono",
            coarse && !showInput && "hidden",
          )}
        />
        {coarse && dictation.listening && (dictation.preview || dictation.hint) ? (
          <p
            aria-live="polite"
            data-testid="dictation-preview"
            className="px-4 pt-1 text-center text-sm text-muted-foreground italic"
          >
            {dictation.preview ? `${dictation.preview}…` : dictation.hint}
          </p>
        ) : null}
        {coarse ? (
          <fieldset className="flex items-center justify-center gap-4 py-2" aria-label="Composer actions">
            {bangMode || attachmentsBlocked ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach files"
                    disabled={draftLocked}
                    onClick={() => {
                      if (!startingThread.current) picker.current?.click();
                    }}
                    className="size-11 rounded-full"
                  >
                    <Paperclip className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach files</TooltipContent>
              </Tooltip>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={showInput ? "Hide keyboard" : "Show keyboard"}
              aria-pressed={showInput}
              onClick={() => setShowInput((visible) => !visible)}
              className="size-14 rounded-full"
            >
              <Keyboard className="size-6" />
            </Button>
            <Button
              type="button"
              size="icon"
              aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
              aria-pressed={dictation.listening}
              disabled={draftLocked}
              onClick={() => {
                if (!startingThread.current) dictation.toggle();
              }}
              className="size-14 rounded-full"
            >
              {dictation.listening ? <Square className="size-6 fill-current" /> : <Mic className="size-6" />}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  size="icon"
                  aria-label={sendLabelOf(busy, effectiveMode)}
                  disabled={!canSend}
                  className="size-11 rounded-full"
                >
                  <ArrowUp className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{sendLabelOf(busy, effectiveMode)}</TooltipContent>
            </Tooltip>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-1 max-sm:justify-center sm:flex-nowrap">
          {bangMode ? null : toolbarStart}
          {bangMode ? null : (
            <>
              <Input
                ref={picker}
                type="file"
                multiple
                tabIndex={-1}
                aria-label="Choose files"
                disabled={draftLocked}
                className="hidden"
                onChange={(event) => onPicked(event.target.files)}
              />
              {!coarse && !attachmentsBlocked ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Attach files"
                      disabled={draftLocked}
                      onClick={() => {
                        if (!startingThread.current) picker.current?.click();
                      }}
                    >
                      <Paperclip />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Attach files</TooltipContent>
                </Tooltip>
              ) : null}
            </>
          )}
          {bangMode ? null : (
            <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 max-sm:justify-center sm:order-none sm:w-auto sm:flex-1">
              {toolbar}
            </div>
          )}
          {stagingFiles ? (
            <span role="status" className="text-xs text-muted-foreground">
              Staging…
            </span>
          ) : null}
          {approvalPending ? (
            <div className="min-w-0 truncate text-xs text-muted-foreground sm:shrink-0">
              Waiting on approval above — new messages queue behind it.
            </div>
          ) : hint ? (
            <div className="min-w-0 truncate sm:shrink-0">{hint}</div>
          ) : null}
          <div className="flex shrink-0 items-center gap-1 max-sm:ml-1">
            {busy && onStop ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="Stop"
                    disabled={stopping}
                    onClick={stop}
                  >
                    <Square className="fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Stop</TooltipContent>
              </Tooltip>
            ) : null}
            {!coarse ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="submit"
                    size="icon-sm"
                    aria-label={sendLabelOf(busy, effectiveMode)}
                    disabled={!canSend}
                  >
                    <ArrowUp />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{sendLabelOf(busy, effectiveMode)}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>
      {attachmentsBlockedReason ? (
        <p role="note" className="px-2 text-xs text-muted-foreground">
          {attachmentsBlockedReason}
        </p>
      ) : null}
      {disabled && disabledReason ? (
        <p role="note" className="px-2 text-xs text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
      {footer}
    </form>
  );
}

export function Composer(props: ComposerProps) {
  return <ComposerForm key={props.target} {...props} />;
}
