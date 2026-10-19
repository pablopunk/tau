import { useRef, useState } from "react";
import { Command } from "@/components/ui/command";
import { Dialog } from "@/components/ui/dialog";
import { SettingsDialogContent, SettingsLayout } from "@/components/ui/settings-layout";
import { NodeSectionGuard } from "./NodeSectionGuard";
import { SettingsNav } from "./SettingsNav";
import { SettingsSearchField, SettingsSearchResults } from "./SettingsSearch";
import { SECTION_BODIES } from "./section-bodies";
import { isNodeSection, SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";
import { type SettingEntry, settingTarget } from "./settings-index";
import { useRevealSetting } from "./use-reveal-setting";
import { useSettingEntries } from "./use-setting-entries";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSectionId;
  /** The node tab active when `section` is a node section. Ignored otherwise. `undefined`: this node. */
  nodeId?: string;
  onTabChange: (section: SettingsSectionId, nodeId?: string) => void;
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
  nodeId,
  onTabChange,
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

  const body = SECTION_BODIES[section]();

  return (
    <Command shouldFilter={false} loop className="rounded-none! bg-transparent p-0">
      <SettingsLayout
        title="Settings"
        sections={SETTINGS_SECTIONS}
        active={section}
        onActiveChange={(id) => {
          onQueryChange("");
          onTabChange(id as SettingsSectionId, undefined);
        }}
        sectionRequest={nonce}
        nav={
          <SettingsNav
            active={{ section, nodeId }}
            onChange={(next) => {
              onQueryChange("");
              onTabChange(next.section, next.nodeId);
              setNonce((current) => current + 1);
            }}
          />
        }
        search={<SettingsSearchField inputRef={inputRef} query={query} onQueryChange={onQueryChange} />}
        results={
          searching ? <SettingsSearchResults query={query} entries={entries} onOpen={openEntry} /> : null
        }
      >
        {isNodeSection(section) ? <NodeSectionGuard nodeId={nodeId}>{body}</NodeSectionGuard> : body}
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
