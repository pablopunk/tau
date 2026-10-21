import type { ImageInput, WhenBusy } from "@tau/protocol";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scopeTarget } from "@/lib/node-keys";
import { cn } from "@/lib/utils";
import { useNodeId } from "@/nodes/node-context";
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
import { loadAttachments } from "./images/attachments";
import { useAttachments } from "./images/use-attachments";

export interface ComposerProps {
  /** Draft key: `"new"` for the new thread page, the conversation id in a thread. */
  target: "new" | string;
  imagesAllowed: boolean;
  busy?: boolean;
  /** Sending is blocked, e.g. while the project is cloning. */
  disabled?: boolean;
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
  /** Delivery mode used while busy; Alt+Enter sends with the other one. Omitted: the server default. */
  whenBusy?: WhenBusy;
  /** Slash commands the menu offers; a command without a handler is hidden. */
  commands?: CommandHandlers;
  /** Project searched by `@` mentions; without it only skills of the user are offered. */
  projectId?: string | null;
  onSend(input: { text: string; images: ImageInput[]; whenBusy?: WhenBusy }): Promise<void>;
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
  !busy ? "Message the agent…" : mode === "followUp" ? "Queue a message…" : "Steer the agent…";

const otherMode = (mode: WhenBusy = "steer"): WhenBusy => (mode === "steer" ? "followUp" : "steer");

function pastedFiles(event: ClipboardEvent): File[] {
  return Array.from(event.clipboardData.files);
}

function ComposerForm({
  target: threadTarget,
  imagesAllowed,
  busy = false,
  disabled = false,
  footer,
  hint,
  toolbar,
  toolbarStart,
  abovePanel,
  whenBusy,
  commands = {},
  projectId,
  onSend,
  onStop,
  onSent,
}: ComposerProps) {
  const target = scopeTarget(threadTarget, useNodeId());
  const [text, setTextState] = useState(() => loadDraft(target));
  // Phones show two big buttons (keyboard / dictate) instead of the text
  // field; the keyboard button reveals it. Dictation wiring comes later.
  const [showInput, setShowInput] = useState(false);
  const [error, setError] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const { attachments, preparing, addFiles, remove, replace } = useAttachments(target, imagesAllowed);
  const [pageDragging, endPageDrag] = usePageDrag(true);
  const [caret, setCaret] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pastedText, setPastedText] = useState<string | null>(null);
  const pasting = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useComposerMenu({ text, caret, commands, projectId, pastedText });
  const bangMode = isBangMode(text);
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !preparing && !disabled;

  useEffect(() => {
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
        setTextState(loadDraft(target));
        replace(loadAttachments(target));
        requestAnimationFrame(() => textarea.current?.focus());
      }),
    [target, replace],
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
      if (!clean) return;
      setShowInput(true);
      const base = textRef.current.replace(/\s+$/, "");
      setText(base ? `${base} ${clean} ` : `${clean} `);
    },
    [setText],
  );
  const dictation = useDictation(appendDictation, setError);

  const runCommand = (name: CommandName, args: string) => {
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
    if (item.disabled) return;
    if (!item.id.startsWith(commandItemId(""))) return insertMention(insertionOf(item.id));
    const name = insertionOf(item.id) as CommandName;
    if (name === "compact" || name === "goal" || name === "loop") return setText(`/${name} `);
    runCommand(name, "");
  };

  const submit = (mode: WhenBusy | undefined = whenBusy) => {
    const command = parseSlashCommand(text);
    if (command && commands[command.name]) return runCommand(command.name, command.args);
    if (isBareBang(text)) {
      setError(BANG_EMPTY_ERROR);
      return;
    }
    const message = text.trim();
    const sent = attachments;
    if (!canSend) return;
    setText("");
    replace([]);
    setError(undefined);
    onSent?.();
    onSend({
      text: message,
      images: sent.map((item) => item.image),
      ...(busy && mode && { whenBusy: mode }),
    }).catch((failure: unknown) => {
      setText(message);
      replace(sent);
      setError(errorText(failure));
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
    if (event.key === "Escape" && busy) return stop();
    if (!isPlainEnter(event)) return;
    event.preventDefault();
    submit(event.altKey || event.metaKey ? otherMode(whenBusy) : whenBusy);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setCaret(event.target.selectionStart);
    if (pasting.current) setPastedText(event.target.value);
    pasting.current = false;
    setText(event.target.value);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = pastedFiles(event).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      pasting.current = true;
      return;
    }
    event.preventDefault();
    addFiles(files);
  };

  const onPicked = (files: FileList | null) => {
    addFiles(Array.from(files ?? []));
    if (picker.current) picker.current.value = "";
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      {abovePanel}
      {pageDragging ? (
        <DropZone
          className="fixed inset-0 z-50"
          onFiles={(files) => {
            endPageDrag();
            addFiles(files);
          }}
        >
          <span className="sr-only">Drop images to attach</span>
        </DropZone>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <MentionMenu
        open={menu.open}
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
        <AttachmentRow attachments={attachments} onRemove={remove} />
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
          value={text}
          onChange={onChange}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={bangMode && !busy ? "Run a shell command…" : placeholderOf(busy, whenBusy)}
          rows={1}
          className={cn(
            "max-h-48 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent",
            bangMode && "pl-7 font-mono",
            !showInput && "max-sm:hidden",
          )}
        />
        <div className="flex gap-2 sm:hidden">
          <Button
            type="button"
            variant="outline"
            aria-label={showInput ? "Hide keyboard" : "Show keyboard"}
            aria-pressed={showInput}
            onClick={() => setShowInput((visible) => !visible)}
            className="h-14 flex-1 text-base"
          >
            <Keyboard className="size-6" />
            Keyboard
          </Button>
          <Button
            type="button"
            aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
            aria-pressed={dictation.listening}
            onClick={dictation.toggle}
            className="h-14 flex-1 text-base"
          >
            {dictation.listening ? <Square className="size-6 fill-current" /> : <Mic className="size-6" />}
            Dictate
          </Button>
        </div>
        <div className="flex flex-wrap items-start gap-1 sm:flex-nowrap">
          {bangMode ? null : toolbarStart}
          {imagesAllowed && !bangMode ? (
            <>
              <Input
                ref={picker}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                tabIndex={-1}
                aria-label="Choose images"
                className="hidden"
                onChange={(event) => onPicked(event.target.files)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach images"
                    onClick={() => picker.current?.click()}
                  >
                    <Paperclip />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach images</TooltipContent>
              </Tooltip>
            </>
          ) : null}
          {bangMode ? null : (
            <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:order-none sm:w-auto sm:flex-1">
              {toolbar}
            </div>
          )}
          {hint ? (
            <div className="ml-auto min-w-0 self-center truncate sm:ml-0 sm:shrink-0">{hint}</div>
          ) : null}
          <div className="flex shrink-0 gap-1 max-sm:ml-1">
            {busy && onStop ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  size="icon"
                  aria-label={busy ? "Send as steer" : "Send"}
                  disabled={!canSend}
                >
                  <ArrowUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{busy ? "Send as steer" : "Send"}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      {footer}
    </form>
  );
}

export function Composer(props: ComposerProps) {
  return <ComposerForm key={props.target} {...props} />;
}
