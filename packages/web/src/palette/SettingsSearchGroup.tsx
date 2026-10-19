import { useMemo } from "react";
import { useOpenSetting } from "@/app/settings-dialog";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { highlightRanges } from "@/settings/search-rank";
import { searchSettings, settingTarget } from "@/settings/settings-index";
import { useSettingEntries } from "@/settings/use-setting-entries";

const MAX_RESULTS = 8;

/** Settings found by the same index and ranking as the Settings dialog search; none while not searching. */
export function useSettingResults(search: string) {
  const entries = useSettingEntries({ withModels: false });
  return useMemo(
    () => (search.trim() === "" ? [] : searchSettings(search, entries).slice(0, MAX_RESULTS)),
    [search, entries],
  );
}

interface SettingsSearchGroupProps {
  search: string;
  results: ReturnType<typeof useSettingResults>;
  run: (action: () => void) => () => void;
}

export function SettingsSearchGroup({ search, results, run }: SettingsSearchGroupProps) {
  const openSetting = useOpenSetting();
  if (results.length === 0) return null;
  return (
    <CommandGroup forceMount heading="Settings">
      {results.map((result) => (
        <CommandItem
          key={result.id}
          forceMount
          value={`setting ${result.id}`}
          onSelect={run(() => openSetting(result.section, settingTarget(result)))}
        >
          <HighlightedText
            className="min-w-0 flex-1 truncate"
            text={result.label}
            ranges={highlightRanges(result.label, search)}
          />
          <span className="shrink-0 text-xs text-muted-foreground">{result.sectionLabel}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
