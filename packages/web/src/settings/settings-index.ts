import type { McpServerStatus, ModelInfo, Project, ProviderInfo } from "@tau/protocol";
import { scoreSearchable } from "./search-rank";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";

export interface SettingEntry {
  /** Unique key of the entry. */
  readonly id: string;
  readonly section: SettingsSectionId;
  /** The `data-setting-id` to reveal. Defaults to `id`. */
  readonly target?: string;
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
}

export interface SettingResult extends SettingEntry {
  readonly sectionLabel: string;
}

/** Every fixed setting row. A test keeps this and the rendered sections in step. */
export const SETTINGS_INDEX: readonly SettingEntry[] = [
  {
    id: "appearance",
    section: "general",
    label: "Appearance",
    description: "Light, dark, or follow your device.",
    keywords: ["theme", "dark mode", "light mode", "dark", "light", "system", "color scheme", "colors"],
  },
  {
    id: "notifications",
    section: "general",
    label: "Notifications",
    description: "Notify me when a run ends and this page is hidden.",
    keywords: ["alerts", "notify", "desktop", "browser notification", "permission", "run finished"],
  },
  {
    id: "default-model",
    section: "models",
    label: "Default model",
    description: "Used for new threads, with its thinking level.",
    keywords: ["model", "llm", "thinking", "thinking levels", "effort", "reasoning", "reasoning effort"],
  },
  {
    id: "fast-model",
    section: "models",
    label: "Fast model",
    description: "Names new threads.",
    keywords: ["model", "title", "naming", "cheap", "small model", "thinking", "effort", "reasoning"],
  },
  {
    id: "projects-folder",
    section: "projects",
    label: "Projects folder",
    description: "Where cloned repositories live.",
    keywords: ["directory", "path", "code folder", "clone", "repos", "repositories", "workspace", "project"],
  },
  {
    id: "github-status",
    section: "github",
    label: "GitHub",
    description: "Connection status, login and token source.",
    keywords: ["gh", "git", "login", "token", "auth", "sign in", "pull request", "repo", "clone"],
  },
  {
    id: "message-mode",
    section: "agent",
    label: "While the agent works, new messages",
    description: "Steer lands at the next tool step. Queue waits for the final answer.",
    keywords: ["steer", "queue", "interrupt", "message mode", "follow-up", "send while running"],
  },
  {
    id: "workspace-default",
    section: "agent",
    label: "New threads use",
    description: "A worktree, the main checkout, or remember per project.",
    keywords: ["worktree", "branch", "checkout", "git worktree", "workspace", "isolation"],
  },
  {
    id: "resources-priority",
    section: "agent",
    label: "Command priority",
    description: "Run agent commands at a lower CPU priority so the computer stays usable.",
    keywords: [
      "resources",
      "cpu",
      "nice",
      "priority",
      "background",
      "balanced",
      "slow",
      "stutter",
      "taskpolicy",
    ],
  },
  {
    id: "resources-heavy-slots",
    section: "agent",
    label: "Heavy command slots",
    description: "Only this many heavy commands (tests, builds, typechecks) run at once; the rest wait.",
    keywords: ["resources", "concurrency", "queue", "slots", "parallel", "tests", "build", "limit", "heavy"],
  },
  {
    id: "resources-memory-limit",
    section: "agent",
    label: "Memory limit per command",
    description: "Stop a command that uses more memory than this.",
    keywords: ["resources", "memory", "ram", "oom", "limit", "kill", "runaway"],
  },
  {
    id: "resources-applies-to",
    section: "agent",
    label: "Apply resource control to",
    description: "Main checkout threads, worktree threads and subagents.",
    keywords: ["resources", "apply", "subagents", "worktree", "main checkout", "threads"],
  },
  {
    id: "fast-compaction",
    section: "agent",
    label: "Fast compaction",
    description: "Score old tool activity with a decision model instead of summarizing.",
    keywords: ["compaction", "fast", "summary", "jev", "typesafe", "decisions"],
  },
  {
    id: "web-search",
    section: "tools",
    label: "Web search",
    description: "Works out of the box. No keys needed.",
    keywords: ["fetch", "browse", "internet", "web", "search the web", "pages"],
  },
  {
    id: "mcp-servers",
    section: "tools",
    label: "MCP servers",
    description: "Add tools the agent can call.",
    keywords: ["mcp", "server", "connector", "integration", "plugin", "extension", "add server", "stdio"],
  },
  {
    id: "claude-connectors",
    section: "tools",
    label: "Claude connectors",
    description: "Let Claude CLI threads use the connectors of your Claude login.",
    keywords: ["claude", "connectors", "claude.ai", "linear", "slack", "mcp"],
  },
  {
    id: "claude-ask-before-writes",
    section: "tools",
    label: "Ask before writes",
    description: "When on, tools that change things ask you first.",
    keywords: ["claude", "connectors", "approve", "approval", "permission", "prompt", "write", "confirm"],
  },
  {
    id: "remote-access",
    section: "remote",
    label: "Remote access",
    description: "Open tau from your phone or any browser with a link.",
    keywords: ["tunnel", "url", "public", "internet", "opentunnel", "phone", "anywhere", "remote", "online"],
  },
  {
    id: "link-device",
    section: "remote",
    label: "Link a device",
    description: "A one-time code, as a QR, a link and a short code.",
    keywords: ["pair", "qr", "code", "phone", "browser", "colleague", "laptop", "add device"],
  },
  {
    id: "devices",
    section: "remote",
    label: "Devices",
    description: "Linked devices: rename, revoke, sign out all.",
    keywords: ["sessions", "revoke", "sign out", "logout", "this device", "linked", "last seen"],
  },
  {
    id: "nodes",
    section: "nodes",
    label: "Nodes",
    description:
      "This node and every node linked to it, in either direction: rename, disconnect, forget, reset identity, open their settings.",
    keywords: [
      "computers",
      "servers",
      "homelab",
      "linked",
      "online",
      "offline",
      "runtimes",
      "group",
      "federation",
      "forget",
      "reset identity",
    ],
  },
  {
    id: "connect-node",
    section: "nodes",
    label: "Connect a node",
    description:
      "Link another tau with one command: a code, a link and a QR. Every node in the group gets full power over every other.",
    keywords: ["link", "add node", "tau connect", "pair", "code", "qr", "second computer", "server"],
  },
];

/** Row ids built from data, such as `provider:openai`. Entries for them come from `dynamicEntries`. */
export const DYNAMIC_ROW_PREFIXES = ["provider:", "mcp:"] as const;

const PROVIDER_KEYWORDS = [
  "api key",
  "key",
  "token",
  "login",
  "sign in",
  "chatgpt",
  "connect",
  "disconnect",
  "provider",
];

export interface DynamicSources {
  readonly providers: readonly ProviderInfo[];
  readonly projects: readonly Project[];
  readonly mcpServers: readonly McpServerStatus[];
  readonly models: readonly ModelInfo[];
}

const providerEntry = (provider: ProviderInfo): SettingEntry => ({
  id: `provider:${provider.id}`,
  section: "providers",
  label: provider.name,
  description: provider.connection ? "Connected. Change or remove its key." : "Add an API key or sign in.",
  keywords: [...PROVIDER_KEYWORDS, provider.id, ...(provider.id === "anthropic" ? ["claude cli"] : [])],
});

const isShownAsOwnRow = (providers: readonly ProviderInfo[]) => (provider: ProviderInfo) =>
  provider.id !== "claude-cli" || !providers.some((other) => other.id === "anthropic");

const projectEntry = (project: Project): SettingEntry => ({
  id: `project:${project.id}`,
  section: "projects",
  target: "projects-folder",
  label: project.name,
  description: "Project",
  keywords: ["project", "repository"],
});

const mcpEntry = (server: McpServerStatus): SettingEntry => ({
  id: `mcp:${server.name}`,
  section: "tools",
  label: server.name,
  description: "MCP server",
  keywords: ["mcp", "server", "connector", server.transport === "stdio" ? "command" : "url"],
});

const modelEntry = (model: ModelInfo): SettingEntry => ({
  id: `model:${model.provider}/${model.modelId}`,
  section: "models",
  target: "default-model",
  label: model.name,
  description: `${model.providerName} model ${model.modelId}`,
  keywords: ["model", model.modelId, model.provider],
});

export function dynamicEntries(sources: DynamicSources): SettingEntry[] {
  return [
    ...sources.providers.filter(isShownAsOwnRow(sources.providers)).map(providerEntry),
    ...sources.projects.map(projectEntry),
    ...sources.mcpServers.map(mcpEntry),
    ...sources.models.map(modelEntry),
  ];
}

const sectionLabelOf = (id: SettingsSectionId) =>
  SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? id;

export const settingTarget = (entry: SettingEntry) => entry.target ?? entry.id;

export function searchSettings(query: string, entries: readonly SettingEntry[]): SettingResult[] {
  return entries
    .map((entry, order) => {
      const result: SettingResult = { ...entry, sectionLabel: sectionLabelOf(entry.section) };
      return { result, order, score: scoreSearchable(query, result) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ result }) => result);
}
