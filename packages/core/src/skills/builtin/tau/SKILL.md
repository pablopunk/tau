---
name: tau
description: Control the tau app with its public CLI: discover capabilities, target nodes, start/read/wait/send threads and manage authorized project operations.
---

# tau

Use the installed `tau` command with your runtime's actual shell tool. Start with `tau --help`, `tau <noun> <verb> --help`, and `tau settings discover --machine`. `TAU_THREAD_ID` identifies your own thread. Do not invent Pi tools in a native runtime: use only delegation tools actually supplied by your runtime and authorized by Tau. CLI thread creation is not a replacement for an awaited-child delegation contract.

## Discover, then act

```sh
tau settings discover --machine
tau settings runtimes --machine
tau nodes list --machine
tau projects list --machine
tau models list --machine
tau threads start "Inspect this synthetic project" --project <projectId> --model <provider/modelId> --request-id <stable-requestId> --wait --machine
tau threads read <threadId> --last 5 --machine
tau threads send <threadId> "Follow up" --request-id <new-stable-requestId> --wait --machine
tau workspaces get <threadId> --machine
```

Use IDs returned by discovery/receipts, never guessed IDs or repeated human-prose parsing. Normal starts choose a runtime from the model automatically; do not ask the user to choose an engine. Existing threads keep their runtime. Capabilities differ; an unsupported operation must remain a refusal, not an implicit switch to Pi.

Add `--node <stable-nodeId>` to API/read/wait/terminal operations to use that node through the existing hub. A disconnected node never falls back locally. IDs are node-scoped: local thread 7 is not remote thread 7. Dedicated `connect <code> --node <url>` retains its different URL meaning.

## Machine outcomes

`--machine` opts into NDJSON v1. Each stdout line is an envelope with `version`, `kind`, `command`, nullable `nodeId/threadId/terminalId/requestId/submissionId/entryId`, `lifecycle`, `observation`, `result`, `error`, and `event`. Diagnostics use stderr. Help remains help. `--json '<body>'` is REQUEST INPUT, not output selection; dedicated `metrics --json` retains its legacy output meaning. Without `--machine`, legacy human/JSON output is unchanged.

Start/send return admission receipts, not proof of completed work. Start does not expose a submission ID; do not invent one. `--wait` emits a receipt followed by a terminal/error record and observes a **thread-idle boundary**, not proof of one particular submission. A completed run explaining a denied Edit does not mean an edit was applied. Check the result and persisted state before claiming effects.

Exits: 0 successful response/admission or observed success; 1 failed/blocked/cancelled/unknown/transport; 2 usage; 3 wait deadline; 130 machine observer SIGINT. Deadline, disconnect and observer SIGINT stop observation only, not the admitted run. Reconcile unknown mutations with their stable request ID and read state; never blindly repeat effects. Use `threads abort` only when stopping is explicitly authorized. No polling loop is needed: `threads wait <id> --machine` observes the thread.

## Other controllable operations

Help/discovery lists icon candidate/set/reset commands, login start/status/URL/cancel, Claude notice acknowledgement, todos, base64 uploads, voice options/transcription/download management, device sign-out, and server update status/refresh/start. These are existing REST operations with the same permissions and capabilities as the web. Do not initiate login, paid transcription, update or service changes unless requested. Human browser authentication/capture and visual rendering are not simulated by the CLI.

`terminals open <threadId> --cols 80 --rows 24 --machine` creates an authorized terminal. `terminals attach <terminalId> --machine` observes it: sequence 0 is ready, binary output is base64, and actual process exit is a terminal event, not thread completion. Stdin accepts NDJSON `{ "type":"input", "encoding":"base64", "data":"..." }` or `{ "type":"resize", "cols":80, "rows":24 }`. Input obeys the protocol byte/dimension caps. EOF detaches; SIGINT detaches with 130; neither kills the process. Closing a terminal is a separate explicitly authorized action.

## Safety

- Ask the user before destructive work; never add confirmation flags merely because you are an agent.
- Most destructive commands require `--yes`. `nodes remove <id> --confirm <exact-name-or-id>` requires typed confirmation; `--yes` is insufficient.
- Do not delete/archive your own thread or its parents. A linked-node identity collision is not evidence of lineage; if identity is uncertain, stop.
- Merge, pull request, update, access rotation and service operations require explicit user intent. Do not interpret a status check as permission to mutate.
- For owned development servers pass explicit ports; never borrow another session's instance. Web dev also needs its explicit backend target.
