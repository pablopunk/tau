# Product recovery foundation contract v1

Base: `15158add980065959fc913544f47b49e521ad806` **plus the complete verified foundation patch**. The Git SHA alone does not contain these new files. Foundation is proof scaffolding, not M1–M5 qualification. No production behavior, Core, REST, fake, dependency, runtime selection or history format changes.

## CLI compatibility (C implements; not activated by foundation)

`--machine` opts into version-1 NDJSON. Generic `--json '<body>'` remains request-body input; dedicated `metrics --json` retains its existing output meaning. No output setting in the UI. Existing stdout/stderr without `--machine` remain unchanged, including receipt JSON followed by answer text for waits. Help is not an operation receipt.

One envelope, all fields present:

```ts
import type { RuntimeLifecycle, SendReceipt, TerminalServerFrame } from "@tau/protocol";

type MachineEnvelope = {
  version: 1;
  kind: "receipt" | "event" | "terminal" | "error";
  command: string;
  nodeId: string | null;
  threadId: string | null;
  terminalId: string | null;
  requestId: string | null;
  submissionId: SendReceipt["submissionId"] | null;
  entryId: NonNullable<SendReceipt["entryId"]> | null;
  lifecycle: RuntimeLifecycle | null;
  observation: "response" | "thread-idle" | null;
  result: unknown;
  error: { source: "protocol" | "cli"; code: string; message: string } | null;
  event: null | {
    stream: "terminal";
    sequence: number;
    frame: TerminalServerFrame | { type: "output"; encoding: "base64"; data: string };
  };
};
```

Use existing opaque IDs. Missing/unavailable identities are null, never invented. Public start returns a summary, not a submission receipt: do not synthesize its submissionId. Native internal AdmissionReceipt is reduced to public SendReceipt today. Preserve existing protocol ErrorCode; CLI-only stable codes are `usage`, `transport_error`, `connection_lost`, `wait_timeout`, `wait_interrupted`, `unsupported`.

Machine stdout contains only envelopes; diagnostics go to stderr. Synchronous operations produce a terminal response with null lifecycle. No-wait start/send produces an admission receipt: exit 0 means admitted, not completed. Wait emits receipt then one terminal/error envelope. Existing wait observes a **thread-idle boundary**, not a proved per-submission terminal outcome: use observation `thread-idle`. Runtime completed does not prove an edit applied, and an explanation after a denied Edit may correctly complete without an edit.

Product CLI exits: 0 successful response/admission or observed successful completion; 1 failure, blocked/cancelled/interrupted/unknown run or transport failure; 2 invalid invocation; 3 wait deadline; machine observer SIGINT 130. Timeout/deadline/disconnect/SIGINT stop observation, not the run. Do not silently retry an unknown mutation. Explicit abort reuses the existing operation and may not claim stronger stopping guarantees than its evidence.

### Terminal machine stream amendment

CLI framing only, **no new server protocol**. Terminal attach uses the same fixed node context as its creation and all other observations. Before implemented, return structured `unsupported`, never raw bytes.

For terminal events: `kind: "event"`, `terminalId` set, `event.stream: "terminal"`. Sequence 0 is ready; increment once per observed frame, preserving replay/live order. Encode binary output byte-exactly as base64 in `{type:"output",encoding:"base64",data}`. Server control frames retain existing TerminalServerFrame. Other envelope kinds have event null. An exit frame means actual terminal-process exit, not thread completion. Abnormal close without exit is `connection_lost`, never synthetic success.

Machine attach stdin is NDJSON: input `{type:"input",encoding:"base64",data}` is decoded under the existing terminal byte cap; resize uses existing TerminalClientFrameSchema dimensions. Send initial resize only after ready. EOF explicitly detaches with result `detached`, null lifecycle; SIGINT exits 130 and detaches without killing the terminal process. No extra server frames or alternate remote stack.

### Target node

C extends existing CLI Server context with optional nodeId and uses existing `nodeApiPrefix(nodeId)` for HTTP, live subscription, polling/read/wait and terminal streams. Resolve a stable node ID once per invocation; never resolve colliding thread IDs globally or fall back locally when remote fails. Existing hub authentication, route allowlist, ownerOnly gates and body/frame caps remain authoritative. Some node-management routes are deliberately local-only. Existing `connect --node <url>` retains its dedicated meaning. No new direct-peer credential stack.

## Existing preparation and runtime seams

Reuse NativeControllerDeps.prepare(InboxItem), PrepareResult, NativeRunPolicy.prepare/launch, NativeService.awaitOperation/cancelChild, WriterBarrier and supervisor identities. No foundation production hook or generic abstraction. Snapshot-before-effects, workspace fences, security/memory limits and protected background work remain intact. Unknown cleanup fences writes/destruction; a timeout Promise is not permission to release ownership. Caller classification stays internal, not a user flag. No executor preference or public admission state machine is added. Existing threads remain on their existing runtime.

B owns native bootstrap instructions and native tools/settings/hooks; C owns common Tau skill text. Native bootstrap may depend on this discovery/output contract, not copied Pi tools. The native compatibility gate must use production controller/buildNativeOptions/imported pinned SDK plus a loopback provider in an owned isolated environment. Existing direct SDK tests with custom options or fake query functions are not that gate. Native/egress boundary probes require a disposable guest, never owner-host probes.

Barrier IDs: B.durable-admission, B.pre-snapshot, B.snapshot-pre-launch, B.durable-launch, B.mutating-tool-request, B.pending-approval, B.persisted-result-pre-finalization, B.completion-pre-parent-result. B adds a private no-op-by-default hook only where an actual test caller requires it and after reviewing the call site; crash timing uses barriers, not sleeps. Denied effects absent, unknown effects not blindly retried, owned processes reconciled; no external exactly-once promise.

## Evidence schemas and exports

Only `packages/testkit/src/product-parity/schema.ts` exports ProductParityRowSchema, ProductParityRow and `parseParityRows(value: unknown): readonly ProductParityRow[]`. Reuses existing executor/lifecycle/SendReceipt/AdmissionReceipt schemas; no new opaque runtime ID or lifecycle vocabulary. `coverage.ts` exports CoverageResult and `checkParityCoverage(rows: readonly ProductParityRow[], requiredIds: readonly string[]): CoverageResult`. It summarizes supplied records, **does not execute CLI/UI and is not a product gate**. Static classification, missing/ambiguous assertions, unsupported evidence and zero assertions cannot pass. An explicit failed required assertion is FAIL even with other blocked evidence. Scan every matching row for explicit FAIL before resolving ambiguous ownership: the same assertion ID remains in both failed and blocked when ownership is ambiguous, counts once as asserted, never counts as passed, and forces overall FAIL regardless of row order.

Final reviewed row amendment: `id` identifies one assertion/evidence record; required `operationId` identifies an existing operation in operations.json and may repeat across distinct record IDs. Required `transport` discriminates `rest | live | terminal | gesture`. The exported TypeBox schema is a union: REST rows require a nonempty string `route`; non-REST rows require `route: null`. `parseParityRows` checks existing protocol routes only for REST, then validates the exact operationId/transport/route triple against the ledger; unknown IDs, wrong transports and mismatched routes are rejected, not inferred from prefixes. Missing operationId/transport is invalid; C must migrate its future row fixtures explicitly, without fallback coercion. Export names/signatures stay unchanged; ProductParityRow gains these required fields and nullable/discriminated route. This is the approved foundation-only type extension, not a production protocol change.

REST identities remain the ledger's `route.<RouteName>` IDs. Known live identity: `live.subscribe`. Known terminal identities: `terminal.attach`, `terminal.input`, `terminal.resize` (existing WebSocket attachment, binary input, JSON resize). They are not REST openTerminal, which creates a terminal, nor `gesture.terminal-rendering`, which only displays it. Gestures have stable ledger IDs: `gesture.file-picker`, `gesture.microphone-capture`, `gesture.image-rendering`, `gesture.terminal-rendering`, `gesture.sidebar-navigation`, `gesture.responsive-layout`, `gesture.scroll-and-selection`. Ledger REST operations now declare transport; streams declare transport and null route; browserGestures are explicit id/label/transport/null-route records rather than untyped labels. Recognizing a gesture never covers its underlying staging/transcription/process mutation. Valid non-REST rows remain subject to the same evidence/ambiguity/FAIL rules and static records still cannot qualify.

Parity records require initial seed, equivalent web/CLI inputs, explicit target node/thread/request/submission identities, permissions and confirmation, receipt/terminal observation, persisted/forbidden effects and assertion IDs. C must implement a runner that actually invokes UI and CLI. Required seeds: A/thread7 and B/thread7; mutating send to B; denied Edit leaves bytes unchanged; retry deduplicates; disconnected B never mutates A; denial explanation completion never claims an applied Edit. Rows from mocked call comparison do not qualify.

`operations.json` is a static starting ledger, not runtime proof. It inventories every current REST route, generic and special CLI commands, exclusions and stream/gesture gaps. Null gesture/Core identity and wrapper-only evidence are explicit unfinished traces. Every pending route assertion stays unverified until C runs its equivalent effects/permission assertions. UI-only is never a justification for excluding a mutation. Upload currently uses base64 JSON, not the exclusion text's multipart claim.

The ledger's dedicatedOverrides audit records actual dispatch, primary routes, action, target, confirmation and response descriptions, separately from null observed receipts. Generic command-table metadata is not authoritative for overrides. `nodes list` requests getNodeDirectory and prints a sorted projection, not listNodes. `nodes remove` resolves via getNodeDirectory, requires typed `--confirm` (not `--yes`), then invokes removeNode; the server calls Core.nodes.group.createExpel and floods the expulsion. `access rotate` previews and accepts --yes or interactive approval, printing sensitive human output. Handoff preview/create are separate branches. Bare pair is a remote-setup/device-mint/poll flow; pair new delegates to the generic table. Connect redeems on an explicit remote peer and stores local link credentials; its message does not prove the background node-link handshake. Disconnect swallows local server-notification errors before removing local peer records. Metrics uses its dedicated JSON-output flag. Status is lifecycle inspection, not a getHealth invocation; update --check is a version comparison (with optional auxiliary listNodes/getUpdateStatus reads), not refreshUpdateStatus; direct update installs/restarts locally rather than invoking startUpdate. These partial analogues remain explicit parity gaps. All manual dispatch branches are statically inventoried; no response description claims an observed receipt or runtime equivalence.

## Scenario and fixture contract

Version `product-recovery/v1`, numeric manifest version 1, seed 15158. Independent A/B/C/D/E namespaces; B/C/E own their separate scenario files. No mutable common case manifest. IDs use namespace dot lowercase ASCII slug. Lane A and D manifests are future lane-owned additions, not empty foundation placeholders.

Small-v1: 16 payload files, 1024 bytes each, 4 directories (16,384 bytes). Monorepo-v1: 4096 payload files, 4096 bytes each, 64 directories (16,777,216 bytes). No network/LFS/company hooks. For index i starting at 0: perDirectory = ceil(files/directories), relative path `dir-${floor(i/perDirectory)}/file-${i}.txt`; bytes repeat ASCII `product-recovery/v1 seed=15158 file=${i}\n` with actual LF, truncated to bytesPerFile. Inventory hash = SHA-256 of concatenated `sha256 + two spaces + relative path + LF` in numeric index order, excluding Git metadata. Definitions are hashed without creating repos in foundation.

Small inventory SHA-256: `9d6142eb1f252c4e04c9e0e584ee54fe6adbb0585627f0a27fdd22e9bf7a968c`.
Monorepo inventory SHA-256: `b1f31fac0964930d4fdaf1e68edf0399da9cbfdfb5468fc3335c73e0efd4e259`.

Future case matrix: root cwd / nested `dir-0`; checkout/worktree; cold/warm; 1/4 concurrent starts; Pi/native model routes; healthy/stalled/disconnected peer; 32/8192 streaming chunks. Chunk i is UTF-8 `chunk-${i}\n`, emitted in numeric order. Desktop 1440x900; narrow-short mobile 360x640. A cold sample owns a fresh home/process; warm uses a previously prepared owned instance. No live-provider baseline is implied. Lane manifests must enumerate selected matrix cells and required assertions before execution; definitions alone are not measured samples.

Stages: submit, request-arrival, workspace-ready, before-input-snapshot, admission-sdk-launch, first-assistant-text, browser-render, failure-cancel. Observations correlate scenario/assertion/request/thread/node IDs and clock-domain ID. Only subtract monotonic readings within one domain; never subtract browser/server clocks. Reuse existing runtime/benchmark and metrics seams, record missing/invalid stages. Server, owned children, browser JS and whole-browser resources are distinct scopes (unmeasured = null). UI proposed p95 visible input/Send/Stop <=100ms and no sustained application tasks >50ms under deterministic streaming; backend/worktree budgets unselected pending controlled baseline/operator agreement. Original incident, company/native/platform unknowns stay BLOCKED.

## Proof drivers: B and E complete later

```sh
mise exec -- pnpm exec tsx scripts/verify-product-artifact.ts --artifacts <manifest> --scenarios <manifest> --output <report>
mise exec -- pnpm exec tsx scripts/verify-native-product.ts --scenarios <manifest> --output <report>
```

Both export import-safe parseArgs, parseScenarioManifest, REQUIRED_ASSERTIONS and `main(argv: readonly string[]): Promise<number>`. Artifact also exports parseArtifactManifest, ArtifactManifest; each exports its own ScenarioManifest. No import-time execution. No shared proof executor/helper framework. B has no dependency on E's driver or vice versa.

Manifest top level: `{version:1,namespace:"B"|"E",seed:integer,fixtures:object,cases:[{id,fixtureId,requiredAssertions:string[]}]}`. Duplicate IDs/assertions and unknown top-level fields rejected. Fixtures are declarations, not interpreted/executed by the skeleton. Missing cases cannot qualify. C's separate manifest additionally defines parity seed scenarios; route ledger IDs require C to add its route coverage cases.

Artifact descriptor: `{version:1,baseline:Artifact,candidate:Artifact}`. Each Artifact requires absolute complete version directory; binary `{path,sha256}`; semver version; platform `{os:"darwin"|"linux"|"windows",arch:"arm64"|"x64"}`; web `{index:{path,sha256},js:[{path,sha256}],css:[{path,sha256}]}` with nonempty JS/CSS; sdk `{name:"@anthropic-ai/claude-agent-sdk",version:exactSemver}`. Both artifact and SDK versions use exact full-string SemVer 2.0 grammar: core numbers and numeric prerelease identifiers have no leading zero except 0; nonempty dot-separated prerelease and build identifiers may coexist (for example 1.2.3-rc.1+build.7); build numeric identifiers may have leading zeros; prefixes, whitespace and empty identifiers are invalid. Stable 0.11.0 remains valid. File paths are unique relative paths without traversal. SHA-256 lowercase hex. Descriptor hashes are **declared and unverified** until E verifies actual files and browser-loaded frontend provenance. No checkout/dist/Node fallback. E must execute complete baseline and candidate directories with owned server/home/browser and strict explicit ports, first text/follow-up/restart/preparation/worktree/nested cwd/cleanup evidence. No artifact downloads or launches in foundation.

Reports: version, driver, BLOCKED verdict/reason codes, scenario-file SHA-256, static evidence kind, declared artifact provenance or native execution flags, required/asserted/passed/failed/blocked counts, per-assertion status/reason, observed/missing stages, scoped resources, persisted/forbidden effects and cleanup. F reports always have zero asserted/passed, null measured resources and cleanup.verified=false. Allowlisted serialization excludes directories, full/auth URLs, config contents, raw errors and tokens. Schema/invocation failures produce fixed safe diagnostic codes, not raw error payloads. Existing output is never overwritten. Generated host manifests/reports belong under ignored `test-artifacts/product-recovery/`.

Driver exits: 0 all required candidate assertions actually pass; 1 assertion failure; 2 BLOCKED/required unsupported or missing evidence; 64 invalid invocation/schema. **F implements 2/64 paths only; 0/1 require B/E's actual execution.** Missing descriptor is BLOCKED, not a skip or local fallback. Zero asserted cases can never qualify. Drivers never accept supplied success reports as execution evidence.

Dedicated `e2e/product-recovery.config.ts` uses testDir `./product-tests`, exact testMatch `product-recovery-artifact.spec.ts`, no webServer and no fallback. The spec lives at `e2e/product-tests/product-recovery-artifact.spec.ts`, outside default `tests/`. Until E implements assertions it fails explicitly BLOCKED; no Playwright skip or green placeholder. CI registration/platform jobs remain integration notes, not new green empty jobs.

## Ownership after F transfer

C: product-parity schema/tests/coverage/operations/contracts and C.scenarios.json; future CLI commands/**, protocol commands.ts/commands.test.ts, common core/skills/builtin/tau/** and product parity E2E. B: native driver/test, B.scenarios.json; future native runtime, supervisor/process-table, native harness/agent-native files, native-product integration/config fixtures. E: artifact driver/test, dedicated config/spec and E.scenarios.json; future runtime benchmark folder/script/config. A: workspaces/** and checkpoints/**, optional NEW processes/interactive-git.ts and test. D: web/src/** and thread scroll/timings E2E. Each new lane file needs an exact allowlist before dispatch; no cross-lane writes.

Shared Core/create-core/conversations-api, other protocol/server/fake/harness registry/governor, common config/manifests/lockfiles/CI remain integrator-owned. No source edits outside the 15 approved foundation paths. Parent approves shared-contract changes. No project commits, merges, pushes or tags. Parent transfers ignored plans explicitly and verifies full patch/hash manifest; isolated agents cannot assume ignored notes exist.
