import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { useSearchParams } from "react-router";
import { SettingsDialog } from "@/settings/SettingsDialog";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/settings/sections";

type OpenSettings = (section?: SettingsSectionId, setting?: string) => void;

const SECTION_PARAM = "settings";
const SETTING_PARAM = "setting";

export const SettingsDialogContext = createContext<OpenSettings>(() => {});

export const useOpenSettings = (section?: SettingsSectionId): (() => void) => {
  const open = useContext(SettingsDialogContext);
  return useCallback(() => open(section), [open, section]);
};

/** Opens the dialog on one exact setting: the section, then scroll and flash that row. */
export const useOpenSetting = () => {
  const open = useContext(SettingsDialogContext);
  return useCallback((section: SettingsSectionId, setting: string) => open(section, setting), [open]);
};

const asSection = (value: string | null): SettingsSectionId | null =>
  SETTINGS_SECTIONS.find((section) => section.id === value)?.id ?? null;

/** The dialog lives in the URL: `?settings=<section>&setting=<row id>`. Search text never does. */
export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const section = asSection(params.get(SECTION_PARAM));
  const setting = params.get(SETTING_PARAM);

  const update = useCallback(
    (next: SettingsSectionId | null, nextSetting?: string) =>
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          copy.delete(SECTION_PARAM);
          copy.delete(SETTING_PARAM);
          if (next) copy.set(SECTION_PARAM, next);
          if (next && nextSetting) copy.set(SETTING_PARAM, nextSetting);
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );

  const openOn = useMemo<OpenSettings>(
    () =>
      (target = "general", targetSetting) =>
        update(target, targetSetting),
    [update],
  );

  return (
    <SettingsDialogContext.Provider value={openOn}>
      {children}
      <SettingsDialog
        open={section !== null}
        onOpenChange={(open) => !open && update(null)}
        section={section ?? "general"}
        onSectionChange={(next) => update(next)}
        setting={setting}
        onSettingOpen={update}
      />
    </SettingsDialogContext.Provider>
  );
}
