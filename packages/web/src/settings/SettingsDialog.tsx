import { useRef, useState } from "react";
import { Command } from "@/components/ui/command";
import { Dialog } from "@/components/ui/dialog";
import { SettingsDialogContent, SettingsLayout } from "@/components/ui/settings-layout";
import { SettingsSearchField, SettingsSearchResults } from "./SettingsSearch";
import { SECTION_BODIES } from "./section-bodies";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";
import { type SettingEntry, settingTarget } from "./settings-index";
import { useRevealSetting } from "./use-reveal-setting";
import { useSettingEntries } from "./use-setting-entries";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  /** The `data-setting-id` to scroll to and flash, from the URL. */
  setting?: string | null;
  onSettingOpen?: (section: SettingsSectionId, setting: string) => void;
}

interface BodyProps extends SettingsDialogProps {
  query: string;
  onQueryChange: (query: string) => void;
}

function SettingsDialogBody({
  section,
  onSectionChange,
  setting = null,
  onSettingOpen,
  query,
  onQueryChange,
}: BodyProps) {
  const [nonce, setNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = useSettingEntries();
  const searching = query.trim() !== "";
  useRevealSetting(searching ? null : setting, nonce, section);

  const openEntry = (entry: SettingEntry) => {
    onSettingOpen?.(entry.section, settingTarget(entry));
    onQueryChange("");
    setNonce((current) => current + 1);
  };

  return (
    <Command shouldFilter={false} loop className="rounded-none! bg-transparent p-0">
      <SettingsLayout
        title="Settings"
        sections={SETTINGS_SECTIONS}
        active={section}
        onActiveChange={(id) => {
          onQueryChange("");
          onSectionChange(id as SettingsSectionId);
        }}
        sectionRequest={nonce}
        search={<SettingsSearchField inputRef={inputRef} query={query} onQueryChange={onQueryChange} />}
        results={
          searching ? <SettingsSearchResults query={query} entries={entries} onOpen={openEntry} /> : null
        }
      >
        {SECTION_BODIES[section]()}
      </SettingsLayout>
    </Command>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [query, setQuery] = useState("");
  const changeOpen = (open: boolean) => {
    if (!open) setQuery("");
    props.onOpenChange(open);
  };
  return (
    <Dialog open={props.open} onOpenChange={changeOpen}>
      <SettingsDialogContent
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (query === "") return;
          event.preventDefault();
          setQuery("");
        }}
      >
        <SettingsDialogBody {...props} query={query} onQueryChange={setQuery} />
      </SettingsDialogContent>
    </Dialog>
  );
}
