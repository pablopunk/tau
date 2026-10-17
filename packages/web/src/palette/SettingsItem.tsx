import { useOpenSettings } from "@/app/settings-dialog";
import { CommandItem } from "@/components/ui/command";
import type { SETTINGS_SECTIONS } from "@/settings/sections";

type Section = (typeof SETTINGS_SECTIONS)[number];

export function SettingsItem({
  section,
  run,
}: {
  section: Section;
  run: (action: () => void) => () => void;
}) {
  const openSection = useOpenSettings(section.id);
  return <CommandItem onSelect={run(openSection)}>Settings: {section.label}</CommandItem>;
}
