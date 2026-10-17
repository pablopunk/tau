import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { preferences, type Theme } from "@/lib/preferences";

const THEME_OPTIONS: readonly SegmentedOption<Theme>[] = [
  { value: "system", label: "System", icon: <MonitorIcon /> },
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
];

const useTheme = () => useSyncExternalStore(preferences.subscribeTheme, preferences.getTheme);

export function AppearanceSettings() {
  const theme = useTheme();
  return (
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
      <FieldDescription>System follows your device and switches with it.</FieldDescription>
    </Field>
  );
}
