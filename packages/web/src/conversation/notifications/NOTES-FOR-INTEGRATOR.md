# Integrator notes (MVP6 agent C)

1. `conversation/tools/ToolCall.tsx` map entries: `agent: AgentTool`, `send_message: AgentSendMessageTool`, `stop_agent: AgentStopTool`, `list_agents: AgentListTool`, `merge_agent: AgentMergeTool` (all in `./`). Keep `task: TaskTool`.
2. `conversation/model/transcript.ts` (near line 84): when `isSubagentNotificationKind(entry.kind)` and `parseSubagentNotification(entry.data)` is defined, emit `{ kind: "subagent-notification", key, data }`; `Transcript.tsx` renders `<SubagentNotificationRow data={item.data} />`. Import from `conversation/notifications/*`.
3. In the `pi.user` branch of the same file, skip the entry when `isNotificationMarkerText(text)` is true (hidden marker input).
4. `Conversation.tsx:81`: `<SubagentBanner parentId={parentId} childId={id} />`.
5. `sidebar/ThreadRow.tsx`: for `depth > 0` pass `context={<SubagentTypeLabel conversation={conversation} />}` to `SidebarThreadRow` (`@/sidebar/subagents/SubagentTypeLabel`).
