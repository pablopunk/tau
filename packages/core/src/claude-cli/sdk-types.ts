export interface ClaudeAuthStatus {
  readonly loggedIn: boolean;
  readonly authMethod: string | null;
  readonly subscriptionType: string | null;
  readonly orgName: string | null;
}

export interface ClaudeAccountInfo {
  readonly organization: string | null;
  readonly subscriptionType: string | null;
}

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh";

export interface ClaudeModelOption {
  readonly value: string;
  readonly resolvedModel: string | null;
  readonly displayName: string;
  readonly description: string;
  readonly supportedEffortLevels: readonly ClaudeEffort[];
  readonly supportsThinkingOff: boolean;
}

export type ClaudeContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export type ClaudeApiContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly source: { readonly type: "base64"; readonly media_type: string; readonly data: string };
    };

export interface ClaudeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ClaudeToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly toolUseId: string;
}

export interface ClaudeToolResult {
  readonly content: readonly ClaudeContentBlock[];
  readonly isError: boolean;
}

/** The in-process MCP server `tau`: the SDK calls it, the adapter implements it. */
export interface ClaudeToolHost {
  listTools(): readonly ClaudeToolDefinition[];
  /** Settles when Pi has run the tool; the SDK waits as long as that takes. */
  callTool(call: ClaudeToolCall): Promise<ClaudeToolResult>;
  /** The port subscribes so `tools/list_changed` reaches the CLI. */
  onToolsChanged(listener: () => void): () => void;
}

export type ClaudeMcpState = "connected" | "failed" | "needs-auth" | "pending" | "disabled";

export interface ClaudeMcpTool {
  readonly name: string;
  readonly readOnly: boolean;
}

export interface ClaudeMcpServerStatus {
  readonly name: string;
  readonly status: ClaudeMcpState;
  readonly source: string | null;
  readonly error: string | null;
  readonly tools: readonly ClaudeMcpTool[];
}

export interface ClaudePermissionRequest {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly toolUseId: string;
  readonly signal: AbortSignal;
  readonly mcpServer: { readonly name: string; readonly source: string } | null;
}

export type ClaudePermissionDecision =
  | { readonly behavior: "allow"; readonly updatedInput: Record<string, unknown> }
  | { readonly behavior: "deny"; readonly message: string };

/** The SDK parks the tool until this settles; permission prompts have no deadline. */
export type ClaudeCanUseTool = (request: ClaudePermissionRequest) => Promise<ClaudePermissionDecision>;

export interface ClaudeUserMessage {
  readonly type: "user";
  readonly message: { readonly role: "user"; readonly content: string | readonly ClaudeApiContentBlock[] };
  readonly parent_tool_use_id: null;
  readonly session_id: "";
}

export type ClaudeInputStream = AsyncIterable<ClaudeUserMessage>;

/** Always set by the adapter; the fake and the pins record them. */
export interface ClaudeQueryOptions {
  readonly prompt: ClaudeInputStream | string;
  readonly model: string;
  readonly cwd: string;
  readonly systemPrompt: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly title: string;
  readonly effort?: ClaudeEffort;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly forkSession?: boolean;
  readonly persistSession?: boolean;
  readonly maxTurns?: number;
  readonly tools: readonly string[];
  readonly strictMcpConfig: boolean;
  readonly canUseTool?: ClaudeCanUseTool;
  readonly settingSources: readonly string[];
  readonly settings: { readonly disableClaudeAiConnectors: boolean; readonly autoCompactEnabled?: boolean };
  readonly permissionMode: "dontAsk" | "default";
  readonly allowedTools: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly includePartialMessages: boolean;
  readonly toolHost?: ClaudeToolHost;
}

/** An SDK message. The adapter reads the fields it needs; the shapes are the SDK's own. */
export interface ClaudeSdkMessage {
  readonly type: string;
  readonly subtype?: string;
  readonly session_id?: string;
  readonly uuid?: string;
  readonly [field: string]: unknown;
}

export interface ClaudeMcpControl {
  mcpServerStatus(): Promise<readonly ClaudeMcpServerStatus[]>;
}

export interface ClaudeContextSummary {
  readonly memoryFileCount: number;
  readonly loadedMcpToolCounts: Readonly<Record<string, number>>;
}

export interface ClaudeProbeOptions {
  readonly settingSources?: readonly string[];
}

export interface ClaudeProbe extends ClaudeMcpControl {
  contextSummary(): Promise<ClaudeContextSummary>;
  close(): void;
}

export interface ClaudeQuery extends AsyncIterable<ClaudeSdkMessage>, ClaudeMcpControl {
  /** Ends the running turn. Never replace it with an abort: the CLI retries a tool call it lost. */
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  applyFlagSettings(settings: Readonly<Record<string, unknown>>): Promise<void>;
  /** `getContextUsage().isAutoCompactEnabled`: proves `autoCompactEnabled: false` was honoured. */
  isAutoCompactEnabled(): Promise<boolean>;
  close(): void;
}

export interface ClaudeSdkPort {
  /** `claude auth status --json`. Reads only the four fields above. */
  authStatus(): Promise<ClaudeAuthStatus>;
  accountInfo(): Promise<ClaudeAccountInfo>;
  supportedModels(): Promise<readonly ClaudeModelOption[]>;
  /** The version of the CLI that ships inside the pinned SDK. */
  bundledCliVersion(): Promise<string>;
  startQuery(options: ClaudeQueryOptions): ClaudeQuery;
  /** A query that never sends a prompt: no model call, no API usage. Connectors load as in a thread. */
  startProbe(options?: ClaudeProbeOptions): ClaudeProbe;
  deleteSession(sessionId: string): Promise<void>;
}

export type ClaudeSdkLoader = () => Promise<ClaudeSdkPort>;
