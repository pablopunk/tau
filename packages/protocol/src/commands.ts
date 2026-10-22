import type { TSchema } from "typebox";
import { type JsonRouteName, type RouteDef, type RouteName, routes } from "./rest";

/**
 * One CLI command per JSON route. A positional is a field path (`params.id`, `body.text`, `query.path`).
 * Every other top-level primitive field of the route is a flag, named by `flagNameOf`.
 */
export interface CommandDef {
  /** `<noun> <verb>`, for example `threads send`. */
  readonly command: string;
  readonly route: JsonRouteName;
  readonly summary: string;
  readonly positionals: readonly string[];
  /** Needs `--yes`. */
  readonly destructive: boolean;
  /** Field paths set by the command itself (`threads archive` sets `body.archived`). */
  readonly fixed?: Readonly<Record<string, string | boolean>>;
  /** Field paths written as `provider/modelId`. The path `body` means the whole body is a model reference. */
  readonly modelRefs?: readonly string[];
  /** The body has nested required fields, so the user must pass `--json '<body>'`. */
  readonly json?: boolean;
}

export const COMMAND_NOUNS = [
  "settings",
  "providers",
  "models",
  "skills",
  "projects",
  "github",
  "threads",
  "workspaces",
  "checkpoints",
  "processes",
  "terminals",
  "timers",
  "goal",
  "mcp",
  "remote",
  "devices",
  "pair",
  "nodes",
  "access",
] as const;

/** Commands with their own flow (`tau pair` has a table verb too); the CLI wires them by hand. */
export const FLOW_COMMANDS = ["connect", "disconnect"] as const;
export type CommandNoun = (typeof COMMAND_NOUNS)[number];

/** Body fields the CLI fills with a random id when the user gives none. */
export const AUTO_FIELDS: readonly string[] = ["requestId"];

export const commands: readonly CommandDef[] = [
  {
    command: "settings get",
    route: "getSettings",
    summary: "Show the settings",
    positionals: [],
    destructive: false,
  },
  {
    command: "settings set-default-model",
    route: "setDefaultModel",
    summary: "Set the default model (provider/modelId)",
    positionals: ["body"],
    modelRefs: ["body"],
    destructive: false,
  },
  {
    command: "settings set-default-thinking",
    route: "setDefaultThinking",
    summary: "Set the default thinking level, or none",
    positionals: ["body.thinkingLevel"],
    destructive: false,
  },
  {
    command: "settings set-fast-model",
    route: "setFastModel",
    summary: "Set the fast model (provider/modelId), or none",
    positionals: ["body.model"],
    modelRefs: ["body.model"],
    destructive: false,
  },
  {
    command: "settings set-voice-model",
    route: "setVoiceModel",
    summary:
      'Set the voice model for dictation: {"kind":"local"} or {"kind":"provider",...} (the body goes in --json), or null',
    positionals: [],
    json: true,
    destructive: false,
  },
  {
    command: "settings set-fast-thinking",
    route: "setFastThinking",
    summary: "Set the fast thinking level, or none",
    positionals: ["body.thinkingLevel"],
    destructive: false,
  },
  {
    command: "settings set-message-mode",
    route: "setMessageMode",
    summary: "Set what a message does while a run is busy (steer or queue)",
    positionals: ["body.mode"],
    destructive: false,
  },
  {
    command: "settings set-workspace-default",
    route: "setWorkspaceDefault",
    summary: "Set the default workspace for new threads (worktree, checkout or per-project)",
    positionals: ["body.mode"],
    destructive: false,
  },
  {
    command: "settings set-setup-skipped",
    route: "setSetupSkipped",
    summary: "Skip or restore first-run setup on this node (a peer can run threads)",
    positionals: ["body.skipped"],
    destructive: false,
  },
  {
    command: "settings set-claude-connectors",
    route: "setClaudeConnectors",
    summary:
      "Choose the Claude connectors threads may use and the tools always allowed (the body goes in --json)",
    positionals: [],
    json: true,
    destructive: false,
  },
  {
    command: "settings set-resources",
    route: "setResources",
    summary:
      "Set priority, heavy-command slots and memory limit for agent commands (the body goes in --json)",
    positionals: [],
    json: true,
    destructive: false,
  },
  {
    command: "settings set-sandbox",
    route: "setSandbox",
    summary: "Set the sandbox switch for main, worktree and subagent threads (the body goes in --json)",
    positionals: [],
    json: true,
    destructive: false,
  },
  {
    command: "settings set-compaction",
    route: "setCompaction",
    summary: "Set the compaction preference: summary or fast with a backend (the body goes in --json)",
    positionals: [],
    json: true,
    destructive: false,
  },
  {
    command: "settings resource-support",
    route: "getResourceSupport",
    summary: "Show what resource limits this node can enforce",
    positionals: [],
    destructive: false,
  },
  {
    command: "settings resource-activity",
    route: "getResourceActivity",
    summary: "List heavy commands running or waiting on this node",
    positionals: [],
    destructive: false,
  },
  {
    command: "settings resource-stop",
    route: "stopResourceCommand",
    summary: "Stop a heavy command listed by resource-activity",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "settings set-projects-folder",
    route: "setProjectsFolder",
    summary: "Set the folder for new projects",
    positionals: ["body.path"],
    destructive: false,
  },
  {
    command: "providers list",
    route: "listProviders",
    summary: "List the providers",
    positionals: [],
    destructive: false,
  },
  {
    command: "providers set-key",
    route: "setProviderKey",
    summary: "Save a provider API key",
    positionals: ["params.id", "body.key"],
    destructive: false,
  },
  {
    command: "providers disconnect",
    route: "disconnectProvider",
    summary: "Remove a provider's saved key",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "providers claude-cli refresh",
    route: "refreshClaudeCli",
    summary: "Check the claude CLI login again",
    positionals: [],
    destructive: false,
  },
  {
    command: "providers claude-cli install",
    route: "installClaudeCliSdk",
    summary: "Install the Claude Agent SDK that the claude-cli provider needs",
    positionals: [],
    destructive: false,
  },
  {
    command: "models list",
    route: "listModels",
    summary: "List the connected models",
    positionals: [],
    destructive: false,
  },
  {
    command: "skills list",
    route: "listSkills",
    summary: "List the skills, for a project with --project",
    positionals: [],
    destructive: false,
  },
  {
    command: "projects list",
    route: "listProjects",
    summary: "List the projects",
    positionals: [],
    destructive: false,
  },
  {
    command: "projects add",
    route: "addProject",
    summary: "Add a folder as a project",
    positionals: ["body.path"],
    destructive: false,
  },
  {
    command: "projects clone",
    route: "cloneProject",
    summary: "Clone a repository as a project",
    positionals: ["body.url"],
    destructive: false,
  },
  {
    command: "projects retry-clone",
    route: "retryClone",
    summary: "Retry a failed clone",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "projects rename",
    route: "renameProject",
    summary: "Rename a project",
    positionals: ["params.id", "body.name"],
    destructive: false,
  },
  {
    command: "projects set-folder",
    route: "setProjectFolder",
    summary: "Point a project at its moved folder",
    positionals: ["params.id", "body.path"],
    destructive: false,
  },
  {
    command: "projects remove",
    route: "removeProject",
    summary: "Remove a project from tau",
    positionals: ["params.id"],
    destructive: true,
  },
  {
    command: "github status",
    route: "getGithubStatus",
    summary: "Show the GitHub connection",
    positionals: [],
    destructive: false,
  },
  {
    command: "github repos",
    route: "listGithubRepos",
    summary: "List your GitHub repositories",
    positionals: [],
    destructive: false,
  },
  {
    command: "github refresh-repos",
    route: "refreshGithubRepos",
    summary: "Fetch the repository list again",
    positionals: [],
    destructive: false,
  },
  {
    command: "github use",
    route: "useGithubRepo",
    summary: "Make a GitHub repository a project (mode: local, clone or folder)",
    positionals: ["body.nameWithOwner", "body.mode"],
    destructive: false,
  },
  {
    command: "threads list",
    route: "listAllConversations",
    summary: "List the threads of every project",
    positionals: [],
    destructive: false,
  },
  {
    command: "threads list-project",
    route: "listConversations",
    summary: "List the threads of one project",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "threads start",
    route: "startConversation",
    summary: "Start a thread in a project with a first message",
    positionals: ["body.text"],
    destructive: false,
  },
  {
    command: "threads rename",
    route: "renameConversation",
    summary: "Rename a thread",
    positionals: ["params.id", "body.title"],
    destructive: false,
  },
  {
    command: "threads send",
    route: "sendMessage",
    summary: "Send a message to a thread",
    positionals: ["params.id", "body.text"],
    destructive: false,
  },
  {
    command: "threads archive",
    route: "archiveConversation",
    summary: "Archive a thread",
    positionals: ["params.id"],
    fixed: { "body.archived": true },
    destructive: false,
  },
  {
    command: "threads unarchive",
    route: "archiveConversation",
    summary: "Bring an archived thread back",
    positionals: ["params.id"],
    fixed: { "body.archived": false },
    destructive: false,
  },
  {
    command: "threads delete",
    route: "removeConversation",
    summary: "Delete a thread for good",
    positionals: ["params.id"],
    destructive: true,
  },
  {
    command: "threads delete-archived",
    route: "deleteArchivedConversations",
    summary: "Delete every archived thread",
    positionals: [],
    destructive: true,
  },
  {
    command: "threads configure",
    route: "configureConversation",
    summary: "Change the model or thinking level of a thread",
    positionals: ["params.id"],
    modelRefs: ["body.model"],
    destructive: false,
  },
  {
    command: "threads retry",
    route: "retryConversation",
    summary: "Retry the last run of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "threads compact",
    route: "compactConversation",
    summary: "Compact the context of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "threads abort",
    route: "abortConversation",
    summary: "Stop the run of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "threads stop-agent",
    route: "stopAgent",
    summary: "Stop a subagent thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "threads fork",
    route: "forkConversation",
    summary: "Fork a thread at an entry",
    positionals: ["params.id", "body.entryId"],
    destructive: false,
  },
  {
    command: "threads rewind-preview",
    route: "rewindPreview",
    summary: "Show what a rewind to an entry would change",
    positionals: ["params.id", "body.entryId"],
    destructive: false,
  },
  {
    command: "threads rewind",
    route: "rewindConversation",
    summary: "Rewind a thread to an entry",
    positionals: ["params.id", "body.entryId"],
    destructive: false,
  },
  {
    command: "threads cancel-queued",
    route: "cancelQueued",
    summary: "Cancel a queued message",
    positionals: ["params.id", "params.itemId"],
    destructive: false,
  },
  {
    command: "threads send-now",
    route: "sendNow",
    summary: "Deliver a queued message now",
    positionals: ["params.id", "body.itemId"],
    destructive: false,
  },
  {
    command: "threads set-queued-mode",
    route: "setQueuedMode",
    summary: "Switch a queued message between steer and queue",
    positionals: ["params.id", "params.itemId", "body.mode"],
    destructive: false,
  },
  {
    command: "workspaces get",
    route: "getWorkspace",
    summary: "Show the workspace state of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "workspaces merge",
    route: "mergeWorkspace",
    summary: "Merge the worktree of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "workspaces pull-request",
    route: "createPullRequest",
    summary: "Open a pull request for the worktree of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "workspaces remove",
    route: "removeWorkspace",
    summary: "Remove the worktree of a thread",
    positionals: ["params.id"],
    destructive: true,
  },
  {
    command: "checkpoints list",
    route: "listCheckpoints",
    summary: "List the checkpoints of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "checkpoints diff",
    route: "getCheckpointDiff",
    summary: "Show the diff of a file at a checkpoint",
    positionals: ["params.id", "params.cid", "query.path"],
    destructive: false,
  },
  {
    command: "processes list",
    route: "listProcesses",
    summary: "List the background processes of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "processes logs",
    route: "getProcessLogs",
    summary: "Show the log tail of a process",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "processes stop",
    route: "stopProcess",
    summary: "Stop a background process",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "processes background",
    route: "backgroundToolCall",
    summary: "Move a running bash call of a thread to the background",
    positionals: ["params.id", "params.callId"],
    destructive: false,
  },
  {
    command: "processes stop-call",
    route: "stopToolCall",
    summary: "Stop a running bash call of a thread",
    positionals: ["params.id", "params.callId"],
    destructive: false,
  },
  {
    command: "terminals list",
    route: "listTerminals",
    summary: "List the terminals of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "terminals close",
    route: "closeTerminal",
    summary: "Close a terminal",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "threads approvals",
    route: "listApprovals",
    summary: "List the tool calls of a thread that wait for approval",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "threads approve",
    route: "decideApproval",
    summary: "Answer a waiting tool call: allow, allow_always or deny",
    positionals: ["params.id", "params.toolUseId", "body.decision"],
    destructive: false,
  },
  {
    command: "timers list",
    route: "listTimers",
    summary: "List the timers of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "timers delete",
    route: "deleteTimer",
    summary: "Delete a timer",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "timers loop",
    route: "startLoop",
    summary: "Run a prompt now and repeat it every --every (like 5m); without --every the agent paces itself",
    positionals: ["params.id", "body.prompt"],
    destructive: false,
  },
  {
    command: "timers stop-loop",
    route: "stopLoop",
    summary: "Stop the /loop timers of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "goal show",
    route: "getGoal",
    summary: "Show the goal of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "goal set",
    route: "setGoal",
    summary: "Set the goal of a thread and start working on it",
    positionals: ["params.id", "body.condition"],
    destructive: false,
  },
  {
    command: "goal clear",
    route: "clearGoal",
    summary: "Clear the goal of a thread",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "mcp list",
    route: "listMcpServers",
    summary: "List the MCP servers, for a project with --project",
    positionals: [],
    destructive: false,
  },
  {
    command: "mcp save",
    route: "saveMcpServer",
    summary: "Add or change an MCP server (the body goes in --json)",
    positionals: ["params.name"],
    json: true,
    destructive: false,
  },
  {
    command: "mcp remove",
    route: "removeMcpServer",
    summary: "Remove an MCP server",
    positionals: ["params.name"],
    destructive: false,
  },
  {
    command: "remote status",
    route: "getRemoteStatus",
    summary: "Show the remote access state and URL",
    positionals: [],
    destructive: false,
  },
  {
    command: "remote on",
    route: "enableRemote",
    summary: "Turn remote access on (opens the tunnel)",
    positionals: [],
    destructive: false,
  },
  {
    command: "remote off",
    route: "disableRemote",
    summary: "Turn remote access off: the URL dies and linked devices stop working",
    positionals: [],
    destructive: true,
  },
  {
    command: "devices list",
    route: "listDevices",
    summary: "List the linked devices",
    positionals: [],
    destructive: false,
  },
  {
    command: "devices rename",
    route: "renameDevice",
    summary: "Rename a linked device",
    positionals: ["params.id", "body.name"],
    destructive: false,
  },
  {
    command: "devices revoke",
    route: "revokeDevice",
    summary: "Revoke a device: its session and open sockets end at once",
    positionals: ["params.id"],
    destructive: true,
  },
  {
    command: "pair new",
    route: "mintPairing",
    summary: "Make a one-time code to link a device (`tau pair` prints it with a QR)",
    positionals: [],
    destructive: false,
  },
  {
    command: "nodes list",
    route: "getNodeDirectory",
    summary: "List every node of the group this node can route to, with hops and `via`",
    positionals: [],
    destructive: false,
  },
  {
    command: "nodes self",
    route: "getNodeSelf",
    summary: "Show this node's id, name and versions",
    positionals: [],
    destructive: false,
  },
  {
    command: "nodes rename",
    route: "renameNode",
    summary: "Rename a linked node",
    positionals: ["params.id", "body.name"],
    destructive: false,
  },
  {
    command: "nodes summary",
    route: "getNodeSummary",
    summary: "Show the titles last seen on a node (what is shown while the node is offline)",
    positionals: ["params.id"],
    destructive: false,
  },
  {
    command: "nodes disconnect",
    route: "disconnectNode",
    summary: "Cut a node's link: its streams close, its device is revoked and its cached summary is deleted",
    positionals: ["params.id"],
    destructive: true,
  },
  {
    command: "nodes forget",
    route: "forgetNode",
    summary:
      "Forget a node on this node only: revoke its device here and close its links (no other node is told)",
    positionals: ["params.id"],
    destructive: true,
  },
  {
    command: "nodes reset-identity",
    route: "resetNodeIdentity",
    summary: "Delete this node's key and links: a new nodeId, every peer disconnected",
    positionals: [],
    destructive: true,
  },
  {
    command: "nodes expulsions",
    route: "listExpulsions",
    summary: "List the nodes removed from the group, who removed them and who confirmed",
    positionals: [],
    destructive: false,
  },
  {
    command: "nodes remove",
    route: "removeNode",
    summary:
      "Remove a node from the WHOLE group (every node cuts it off; it must reset its identity to rejoin). `forget` only acts on this node. Needs --confirm <node name or id>; it does not undo what the node did, run `tau access rotate` after",
    positionals: ["params.id"],
    destructive: true,
  },
  {
    command: "access rotate",
    route: "rotateAccess",
    summary:
      "Revoke every device not listed with --keep and swap this node's master token live (browsers here are signed out); the new token is printed and written to <home>/token",
    positionals: [],
    destructive: true,
  },
];

const IMAGES = "Images are not text; agents have no use for them here.";
const BROWSER_LOGIN = "Browser sign-in needs a person at the browser.";
const TYPING_HELPER = "A typing helper for the UI; agents have `ls`.";

const UPDATE_CHECK = "`tau update --check` covers it.";

export const COMMAND_EXCLUSIONS = {
  listNodes: "`tau nodes list` shows the directory (`getNodeDirectory`), a superset.",
  getProjectIcon: IMAGES,
  getIconCandidate: IMAGES,
  listIconCandidates: IMAGES,
  setProjectIcon: IMAGES,
  resetProjectIcon: IMAGES,
  startLogin: BROWSER_LOGIN,
  getLogin: BROWSER_LOGIN,
  submitLoginUrl: BROWSER_LOGIN,
  cancelLogin: BROWSER_LOGIN,
  acknowledgeClaudeCli: "The notice is read by a person in Settings.",
  getUpdateStatus: UPDATE_CHECK,
  refreshUpdateStatus: UPDATE_CHECK,
  startUpdate: "Owner only, and `tau update` runs the update itself.",
  openTerminal: "A terminal needs a screen.",
  getTerminalsAvailable: "A state the web reads to show or hide the Terminal button.",
  suggestDirectories: TYPING_HELPER,
  getVoiceOptions: "The web settings row reads it to render the voice picker; agents have no microphone.",
  transcribeVoice: "Needs recorded audio bytes; agents have no microphone.",
  removeVoiceModel: "The web settings row deletes the download next to unsetting the default.",
  warmVoice: "Prefetch from the composer mic toggle; agents have no microphone.",
  getSuggestedCodeFolder: TYPING_HELPER,
  suggestProjectFiles: TYPING_HELPER,
  redeemPairing:
    "Called by the pair page and `tau connect` with a one-time code, never by an agent or the CLI.",
  getHealth: "A probe for the watchdog and the service manager; `tau status` shows the same facts.",
  getMetrics: "Handled by the dedicated `tau metrics` command with human-readable output.",
  recreateRemote: "UI only: it clears every linked device, so it needs the confirmation dialog.",
  linkNode: "A WebSocket one node's server dials with a node secret; not an HTTP call.",
  signOutAllDevices: "UI only: it signs out every browser and phone, this one included.",
  updateTodos: "UI only: the todo panel sends the edited list; the CLI has no todo surface.",
  stageUpload:
    "Raw file bytes go over multipart from the web composer; no agent types those on a command line.",
} as const satisfies Partial<Record<RouteName, string>>;

export type ExcludedRoute = keyof typeof COMMAND_EXCLUSIONS;

export const commandOf = (name: string): CommandDef | undefined =>
  commands.find((entry) => entry.command === name);

/** `projectId` is `--project`; any other field is its kebab-case name (`thinkingLevel` is `--thinking-level`). */
export function flagNameOf(field: string): string {
  if (field === "projectId") return "project";
  return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

interface SchemaNode {
  readonly type?: string;
  readonly const?: unknown;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly required?: readonly string[];
  readonly anyOf?: readonly SchemaNode[];
}

export interface RouteField {
  /** `params.id`, `query.force`, `body.text`. */
  readonly path: string;
  readonly source: "params" | "query" | "body";
  readonly name: string;
  readonly required: boolean;
  /** A string, number, boolean or literal, possibly `null`: it can be a positional or a flag. */
  readonly primitive: boolean;
  readonly boolean: boolean;
  readonly nullable: boolean;
  readonly node: SchemaNode;
}

const PRIMITIVE_TYPES = ["string", "number", "integer", "boolean", "null"];

function isPrimitive(node: SchemaNode): boolean {
  if (node.anyOf) return node.anyOf.every(isPrimitive);
  return node.const !== undefined || PRIMITIVE_TYPES.includes(node.type ?? "");
}

const variantsOf = (node: SchemaNode): readonly SchemaNode[] => {
  const objects = node.anyOf?.filter((member) => member.properties) ?? [];
  return objects.length > 0 ? objects : [node];
};

function fieldsOfSchema(source: RouteField["source"], schema: TSchema | undefined): RouteField[] {
  if (!schema) return [];
  const found = new Map<string, RouteField>();
  for (const variant of variantsOf(schema as SchemaNode)) {
    for (const [name, node] of Object.entries(variant.properties ?? {})) {
      const required = variant.required?.includes(name) ?? false;
      const previous = found.get(name);
      found.set(name, {
        path: `${source}.${name}`,
        source,
        name,
        required: required || (previous?.required ?? false),
        primitive: isPrimitive(node),
        boolean: node.type === "boolean",
        nullable: node.anyOf?.some((member) => member.type === "null") ?? false,
        node,
      });
    }
  }
  return [...found.values()];
}

/** The top-level fields of a route's params, query and body. For a union body, a field is required when any variant requires it. */
export function routeFields(route: RouteName): RouteField[] {
  const def: RouteDef = routes[route];
  return [
    ...fieldsOfSchema("params", def.params),
    ...fieldsOfSchema("query", def.query),
    ...fieldsOfSchema("body", def.body),
  ];
}

/** Whether the body (or a body field) holds a `{ provider, modelId }` object. */
export function isModelRefNode(node: SchemaNode): boolean {
  return variantsOf(node).some((variant) => variant.properties?.provider && variant.properties?.modelId);
}

/** `body` when the whole body is a model reference, else the node of a field path. */
export function nodeAtPath(route: RouteName, path: string): SchemaNode | undefined {
  if (path === "body") return (routes[route] as RouteDef).body as SchemaNode | undefined;
  return routeFields(route).find((field) => field.path === path)?.node;
}
