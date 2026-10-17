import { useEffect, useState } from "react";
import type { MentionItem } from "@/components/ui/mention-menu";
import { activeMention, type MentionTrigger } from "./mentions";
import { movedIndex } from "./menu-keys";
import { availableCommands, type CommandHandlers, filterCommands, slashQuery } from "./slash-commands";
import { useMentionItems } from "./use-mention-items";

export const commandItemId = (name: string) => `cmd:${name}`;

export interface ComposerMenuInput {
  text: string;
  caret: number;
  commands: CommandHandlers;
  projectId: string | null | undefined;
  pastedText: string | null;
}

export interface ComposerMenu {
  open: boolean;
  items: MentionItem[];
  activeIndex: number;
  mention: MentionTrigger | null;
  setActiveIndex(index: number): void;
  move(delta: 1 | -1): void;
  close(): void;
  activeItem(): MentionItem | undefined;
}

function commandItems(commands: CommandHandlers, query: string | null): MentionItem[] {
  if (query === null) return [];
  return filterCommands(availableCommands(commands), query).map((command) => ({
    id: commandItemId(command.name),
    label: `/${command.name}`,
    description: command.description,
  }));
}

export function useComposerMenu({
  text,
  caret,
  commands,
  projectId,
  pastedText,
}: ComposerMenuInput): ComposerMenu {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedText, setDismissedText] = useState<string | null>(null);
  const slash = slashQuery(text);
  const mention = slash === null && pastedText !== text ? activeMention(text, caret) : null;
  const mentionItems = useMentionItems(projectId, mention?.query ?? null);
  const items = slash !== null ? commandItems(commands, slash) : mentionItems;
  const open = items.length > 0 && dismissedText !== text;
  const queryKey = `${slash}|${mention?.start}|${mention?.query}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart at the first row when the query changes
  useEffect(() => setActiveIndex(0), [queryKey]);

  return {
    open,
    items,
    activeIndex: Math.min(activeIndex, Math.max(items.length - 1, 0)),
    mention,
    setActiveIndex,
    move: (delta) => setActiveIndex((current) => movedIndex(current, delta, items.length)),
    close: () => setDismissedText(text),
    activeItem: () => items[Math.min(activeIndex, items.length - 1)],
  };
}
