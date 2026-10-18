import { type RefObject, useMemo } from "react";
import { CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { useHotkey } from "@/lib/hotkeys";
import { highlightRanges } from "./search-rank";
import { type SettingEntry, type SettingResult, searchSettings } from "./settings-index";

export const SEARCH_PLACEHOLDER = "Search settings";

interface SearchFieldProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
}

/** The search field. Must sit inside a `Command` with `shouldFilter={false}`. */
export function SettingsSearchField({ inputRef, query, onQueryChange }: SearchFieldProps) {
  const focus = () => inputRef.current?.focus();
  useHotkey("mod+f", focus);
  useHotkey("/", focus);
  return (
    <div className="pb-2">
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={onQueryChange}
        placeholder={SEARCH_PLACEHOLDER}
        aria-label={SEARCH_PLACEHOLDER}
      />
    </div>
  );
}

function groupBySection(results: SettingResult[]): Array<[string, SettingResult[]]> {
  const groups = new Map<string, SettingResult[]>();
  for (const result of results)
    groups.set(result.sectionLabel, [...(groups.get(result.sectionLabel) ?? []), result]);
  return [...groups];
}

function ResultRow({ result, query, onOpen }: { result: SettingResult; query: string; onOpen: () => void }) {
  return (
    <CommandItem value={result.id} onSelect={onOpen} className="items-start gap-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <HighlightedText
          className="truncate text-sm font-medium"
          text={result.label}
          ranges={highlightRanges(result.label, query)}
        />
        <HighlightedText
          className="line-clamp-2 text-xs font-normal text-muted-foreground"
          text={result.description}
          ranges={highlightRanges(result.description, query)}
        />
      </div>
    </CommandItem>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      <p className="text-sm font-medium">No settings match “{query.trim()}”</p>
      <p className="text-sm text-muted-foreground">
        Try a shorter word, or something like “theme”, “api key” or “mcp”.
      </p>
    </div>
  );
}

interface ResultsProps {
  query: string;
  entries: readonly SettingEntry[];
  onOpen: (entry: SettingEntry) => void;
}

/** Ranked results grouped by section. Must sit inside the same `Command` as the field. */
export function SettingsSearchResults({ query, entries, onOpen }: ResultsProps) {
  const results = useMemo(() => searchSettings(query, entries), [query, entries]);
  if (results.length === 0) return <NoResults query={query} />;
  return (
    <CommandList className="max-h-none overflow-visible">
      {groupBySection(results).map(([section, rows]) => (
        <CommandGroup key={section} heading={section} className="p-0 pb-2">
          {rows.map((result) => (
            <ResultRow key={result.id} result={result} query={query} onOpen={() => onOpen(result)} />
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  );
}
