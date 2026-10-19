/** Not a node's config: general app behavior, the pairing/connect UI, and this node's own remote access. */
export const APP_SECTIONS = [
  { id: "general", label: "General" },
  { id: "remote", label: "Remote access" },
  { id: "nodes", label: "Nodes" },
] as const;

/** Shown once per node tab (This node, or any linked node), scoped to that node's own api. */
export const NODE_SECTIONS = [
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "projects", label: "Projects" },
  { id: "github", label: "GitHub" },
  { id: "agent", label: "Agent" },
  { id: "tools", label: "Tools" },
] as const;

export const SETTINGS_SECTIONS = [...APP_SECTIONS, ...NODE_SECTIONS] as const;

export type AppSectionId = (typeof APP_SECTIONS)[number]["id"];
export type NodeSectionId = (typeof NODE_SECTIONS)[number]["id"];
export type SettingsSectionId = AppSectionId | NodeSectionId;

export const isNodeSection = (id: SettingsSectionId): id is NodeSectionId =>
  NODE_SECTIONS.some((section) => section.id === id);

export const DEFAULT_APP_SECTION: AppSectionId = "general";
export const DEFAULT_NODE_SECTION: NodeSectionId = "providers";
