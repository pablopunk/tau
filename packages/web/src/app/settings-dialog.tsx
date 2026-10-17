import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { SettingsDialog } from "@/settings/SettingsDialog";
import type { SettingsSectionId } from "@/settings/sections";

type OpenSettings = (section?: SettingsSectionId) => void;

export const SettingsDialogContext = createContext<OpenSettings>(() => {});

export const useOpenSettings = (section?: SettingsSectionId): (() => void) => {
  const open = useContext(SettingsDialogContext);
  return useCallback(() => open(section), [open, section]);
};

export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>("general");
  const openOn = useMemo<OpenSettings>(
    () =>
      (target = "general") => {
        setSection(target);
        setOpen(true);
      },
    [],
  );
  return (
    <SettingsDialogContext.Provider value={openOn}>
      {children}
      <SettingsDialog open={open} onOpenChange={setOpen} section={section} onSectionChange={setSection} />
    </SettingsDialogContext.Provider>
  );
}
