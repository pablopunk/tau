import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SettingRow } from "@/components/ui/settings-layout";
import { preferences, type Theme } from "@/lib/preferences";

const THEME_OPTIONS: readonly SegmentedOption<Theme>[] = [
  { value: "system", label: "System", icon: <MonitorIcon /> },
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
];

const SYSTEM_CAPTION = "System follows your device and switches with it.";

const useTheme = () => useSyncExternalStore(preferences.subscribeTheme, preferences.getTheme);

export function AppearanceSettings() {
  const theme = useTheme();
  return (
    <SettingRow id="appearance">
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Appearance</FieldLabel>
          <SegmentedControl
            aria-label="Theme"
            value={theme}
            onChange={preferences.setTheme}
            options={THEME_OPTIONS}
          />
        </div>
        {theme === "system" && <FieldDescription>{SYSTEM_CAPTION}</FieldDescription>}
      </Field>
    </SettingRow>
  );
}
