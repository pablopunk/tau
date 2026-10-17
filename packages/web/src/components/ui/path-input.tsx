import type { PathSuggestion } from "@pi-everywhere/protocol";
import { FolderGit2Icon, FolderIcon } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePathSuggestions } from "@/lib/queries";

const DEBOUNCE_MS = 120;

const canSuggestFor = (value: string) => value.startsWith("/") || value.startsWith("~");
const acceptedValue = (suggestion: PathSuggestion) => `${suggestion.display}/`;
const isTypedExactly = (value: string, suggestion: PathSuggestion) => value.trim() === suggestion.display;
const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();

function SuggestionItem({
  suggestion,
  active,
  onAccept,
}: {
  suggestion: PathSuggestion;
  active: boolean;
  onAccept(suggestion: PathSuggestion): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const Icon = suggestion.isGitRepo ? FolderGit2Icon : FolderIcon;
  return (
    <CommandItem
      ref={ref}
      value={suggestion.path}
      onMouseDown={keepFocus}
      onSelect={() => onAccept(suggestion)}
    >
      <Icon aria-label={suggestion.isGitRepo ? "Git repository" : undefined} />
      <span className="truncate">{suggestion.display}</span>
    </CommandItem>
  );
}

export interface PathInputProps extends Omit<ComponentProps<typeof Input>, "value" | "onChange"> {
  value: string;
  onValueChange(value: string): void;
}

/** A text input for a local folder with live suggestions; `~/` works. Enter or Tab accepts and goes into the folder. */
export function PathInput({ value, onValueChange, onKeyDown, onFocus, onBlur, ...props }: PathInputProps) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(value, DEBOUNCE_MS);
  const { data } = usePathSuggestions(debounced, canSuggestFor(debounced));
  const suggestions = canSuggestFor(value) ? (data ?? []) : [];
  const current = suggestions[Math.min(active, suggestions.length - 1)];
  const open = focused && !dismissed && current !== undefined;

  const change = (next: string) => {
    onValueChange(next);
    setActive(0);
    setDismissed(false);
  };
  const accept = (suggestion: PathSuggestion) => change(acceptedValue(suggestion));
  const move = (step: number) => setActive((index) => (index + step + suggestions.length) % suggestions.length);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (!open || !current) {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        setDismissed(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
    } else if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      accept(current);
    } else if (event.key === "Enter" && !isTypedExactly(value, current)) {
      event.preventDefault();
      accept(current);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => !next && setDismissed(true)}>
      <PopoverAnchor asChild>
        <div className="w-full">
          <Input
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            {...props}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            value={value}
            onChange={(event) => change(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) gap-0 p-0"
        onOpenAutoFocus={keepFocus}
        onCloseAutoFocus={keepFocus}
        onInteractOutside={keepFocus}
      >
        <Command
          shouldFilter={false}
          value={current?.path}
          onValueChange={(path) => setActive(Math.max(0, suggestions.findIndex((item) => item.path === path)))}
        >
          <CommandList id={listId} aria-label="Folder suggestions">
            {suggestions.map((suggestion) => (
              <SuggestionItem
                key={suggestion.path}
                suggestion={suggestion}
                active={suggestion.path === current?.path}
                onAccept={accept}
              />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
