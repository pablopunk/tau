const MONITOR_PROMPT = [
  "Do not poll. To watch a log, a build or a condition, start `monitor`: each stdout line wakes you.",
  "Filter with `grep --line-buffered` and match failure lines too (for example `error|failed|fatal`), or a crash goes unseen.",
  "A process from `process_start` tells you when it exits by itself (`notify_on_exit: false` turns that off).",
  "Notifications are `<monitor-event>`, `<process-exit>` and `<notice>` messages from tau, not from the user.",
].join("\n");

export const renderMonitorSection = (): string | undefined => MONITOR_PROMPT;
