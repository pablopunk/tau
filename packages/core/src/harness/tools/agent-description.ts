export const AGENT_DESCRIPTION = [
  "Start a subagent: a separate agent thread that works on one task while you keep going. The user can open it from the sidebar.",
  "",
  "How to use it:",
  "- The subagent does not see this conversation. Write `prompt` as a complete, self-contained brief: the goal, the relevant files and paths, what to return, and any constraints.",
  '- `subagent_type` picks an agent type from the available types. Omit it for "general-purpose". Use "fork" to start a subagent that inherits this whole conversation; the prompt is then its next message.',
  "- `model` is optional. The default is your own model. Go lighter for search, summaries, mechanical edits and bulk fan-out, never heavier than your own unless the user asked, and an explicit user instruction about the model always wins; the connected models, with bands and prices, are listed in the subagents section of your instructions. A subagent can only use models of your own provider: use `provider/modelId` of that provider, or an alias such as `sonnet`, `opus`, `haiku` or `fast`. Models of other providers are refused.",
  '- `thinking` is optional: off, minimal, low, medium, high, xhigh or max. Use the effort the user asked for in this conversation (for example "Sonnet with low effort"); otherwise leave it out and the subagent inherits yours. It is clamped to what the subagent\'s model supports.',
  '- `isolation: "worktree"` gives the subagent its own git worktree and branch, so parallel agents do not touch the same files. Use merge_agent to bring its committed work back. It fails in a project that is not a git repository.',
  "- By default the subagent runs in the background and this call returns at once with its id. You get a notification with its report when it answers, and that wakes you if you are idle. Do not poll, sleep or check on it; keep working on something else, or end your turn and wait for the notification.",
  "- Set `run_in_background: false` only when you cannot continue without the answer. The call then waits and returns the final report.",
  "- Launch independent subagents in the same turn so they run in parallel.",
  "- Never invent or guess a subagent's result. Until its notification arrives, say that it is still running. A notification can be queued until the user's next message when your last run failed.",
  "- Subagents cannot start subagents. Use send_message to continue one, stop_agent to stop one, remove_agent to delete finished ones, list_agents to see yours.",
].join("\n");

export const SEND_MESSAGE_DESCRIPTION = [
  "Send a message to one of your subagents by id. Its next answer arrives as a notification; do not poll.",
  '`mode: "followUp"` (default) queues the message after the current work. `mode: "steer"` interrupts the current work with new direction.',
  "The subagent does not see your conversation, so make the message self-contained. Only your own subagents can be messaged.",
].join("\n");

export const STOP_AGENT_DESCRIPTION =
  "Stop the current run of one of your subagents by id. A notification with status stopped follows. The subagent stays and can be given new work with send_message.";

export const LIST_AGENTS_DESCRIPTION =
  "List your subagents with id, description, type, model, thinking level, status, last activity and worktree path. Use it to find an id; it is not a way to wait for results, notifications arrive by themselves.";

export const MERGE_AGENT_DESCRIPTION = [
  "Merge the committed work of a subagent that has its own worktree into this thread's checkout (rebase, then fast-forward only).",
  "It refuses while the subagent is running: wait for its notification first.",
  "On a conflict it fails: use send_message to ask the subagent to rebase onto the base branch and resolve the conflicts, wait for its notification, then call merge_agent again.",
].join("\n");

export const REMOVE_AGENT_DESCRIPTION = [
  "Delete subagent threads by id (`ids`, one or several) so they leave the sidebar. Use it for subagents that are done, stopped or failed and whose result you no longer need.",
  "It refuses a subagent that is still running: call stop_agent first. It refuses a subagent whose worktree has unmerged work: call merge_agent first, or pass `force: true` only when the user agreed to discard that work.",
  "Removal cannot be undone.",
].join("\n");
