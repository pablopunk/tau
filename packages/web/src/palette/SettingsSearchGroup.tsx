import { useMemo } from "react";
import { useOpenSetting } from "@/app/settings-dialog";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { highlightRanges } from "@/settings/search-rank";
import { searchSettings, settingTarget } from "@/settings/settings-index";
import { useSettingEntries } from "@/settings/use-setting-entries";

const MAX_RESULTS = 8;

interface SettingsSearchGroupProps {
  search: string;
  run: (action: () => void) => () => void;
}

/** Settings found by the same index and ranking as the Settings dialog search. Shown only while searching. */
export function SettingsSearchGroup({ search, run }: SettingsSearchGroupProps) {
  const entries = useSettingEntries();
  const openSetting = useOpenSetting();
  const results = useMemo(
    () => (search.trim() === "" ? [] : searchSettings(search, entries).slice(0, MAX_RESULTS)),
    [search, entries],
  );
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
          <HighlightedText text={result.label} ranges={highlightRanges(result.label, search)} />
          <span className="ml-auto text-xs text-muted-foreground">{result.sectionLabel}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
