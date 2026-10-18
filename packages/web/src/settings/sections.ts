export const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "projects", label: "Projects" },
  { id: "github", label: "GitHub" },
  { id: "agent", label: "Agent" },
  { id: "tools", label: "Tools" },
  { id: "remote", label: "Remote access" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
