* Render `<BusyModeHint busy={busy} />` (`conversation/queue/BusyModeHint`) in `Conversation.tsx`, e.g. in the Composer `footer` slot; `whenBusyOf` there can replace the inline mapping.
* `core/src/contract.test.ts`: remove `"queue"` from `PENDING_TAGS`.
* `messages/QueuedMessages.tsx`: the badge now carries "Steering"/"Queued"; set `MODE_LABELS` to `steer: "Will steer the agent"`, `followUp: "Will send when the agent is done"`.
