# Notes from owner D (web)

* Mount `<ClaudeConnectorsSection />` (`settings/ClaudeConnectorsSection.tsx`) in `settings/tools/ToolsSection.tsx`, after the MCP server lists. It renders nothing unless the Claude CLI provider is ready and has connectors. Its `SettingRow` id is `claude-connectors`.
* Add a settings-index entry in `settings/settings-index.ts` for `claude-connectors` (section `tools`, title "Claude connectors", keywords: claude, connectors, claude.ai, linear, slack, mcp).
* Mount `<ToolApproval conversationId={id} />` (`conversation/ToolApproval.tsx`) in the transcript, above the composer or at the end of `Transcript.tsx`. It polls via `useApprovals`, which the `approvals` change keeps fresh.
* `claude_connector` is registered in `conversation/tools/ToolCall.tsx`.
