# Plan: Full-state fast compaction

**Status:** review draft; planning only. No implementation in this change.

## Goal and invariants

Replace the shipped bare-item scoring input with the Jev-style shared state: the fitted pre-cut conversation, tool results represented by size notes, and a verbatim goal built from recent user prompts. Keep the fast path decision-only; it must not call a generative model to produce or evaluate a summary.

Load-bearing Pi behavior:

- `beforeCompact` returns `{ summary }` only after every required decision succeeds, or returns `undefined` to let Pi run its built-in compactor. It never returns `{ decline: true }`.
- All failures, timeouts, cancellation, an unfittable state/request, or an insufficient reduction return `undefined`; do not throw out of the hook or apply partial decisions.
- The hook supplies a **summary string at Pi's selected cut point**. It cannot replace the transcript or rewrite the retained tail. This remains true even when the summary contains verbatim text.
- Manual compact instructions continue to defer to Pi (`undefined`). The existing `summary` default / opt-in `fast` setting stays unchanged.
- A fallback to Pi's built-in compactor may invoke its normal summarization model; the fast-compaction path itself adds no generative LLM calls.

## Findings from the current implementation

The current gap is in `packages/core/src/harness/fast-compaction.ts`:

- `scoreFrame()` calls `predicate(frame.callText, ...)` and `predicate(frame.resultText, ...)`. Each question therefore sees only its own bare item, not a common history or goal.
- `runFastCompaction()` consumes `entries` and does not use the supplied `compaction.messages` source transcript.
- `groupFrames()` also emits ordinary user/assistant text entries as frames, so the scoring path can treat free-standing text as a removable item. The port should only score paired tool calls/results; user/assistant text is context and remains verbatim in the summary.
- The current verdict requires both probabilities to be above the threshold to keep the full exchange. The reference algorithm gives `keepResult` priority: a high result-retention score keeps both call and result even if `keepCall` is low. The port should correct this behavior and use the reference `>=` boundary.
- `DecideClient.predicate()` is single-question, and the OpenAI client only parses `answers[0]`. The reference sends multiple named questions against one shared state per request, so the client contract and fakes need a batch form.

The current tests and `e2e/tests/fast-compaction-mocks.ts` likewise validate one question at a time. These are part of the contract change, not just mock cleanup.

## Reference findings

The original `fast-jev-compaction` README and `src/state.ts` / `src/compact.ts` were fetched and read. The `radqnico/opencode-jev-compaction` README describes the same state, fitting, question batching, and 25k/30k defaults. The OpenCode report at `zenn.dev/uhu/articles/1007b909714cef` provides real old-call scores and the reason that port chose a lower threshold.

Relevant links are collected at the end of this document. Key findings:

- The state is the whole input transcript, oldest first, with each tool result replaced by a status/size note. The state contains a task `goal`; the default is the last three user prompts.
- Two `noul` questions are asked per unpinned tool call: retain the call, and retain the full result verbatim. Multiple calls' questions are batched with the same state; every batch resends the state.
- The upstream fitting defaults are `maxStateTokens=25,000` and `maxRequestTokens=30,000`.
- The exact upstream fitting order is ported below. Its estimator is a deliberately conservative heuristic, not a tokenizer.
- The upstream source currently truncates each goal prompt to 500 characters. Tau's requirement is **verbatim** prompts, so Tau will intentionally not copy that truncation; an over-budget verbatim goal makes the state unfittable and falls back.
- Upstream's action rule is: `keepResult >= threshold` → keep both; otherwise `keepCall >= threshold` → keep the call and truncate the result; otherwise drop both. A truncated result shorter than the truncation head plus the note threshold stays whole, as there is no meaningful reduction.
- The Zenn report measured old TypeSafe calls at `keepCall=0.17–0.23` and `keepResult=0.11–0.14`. At 0.5 those samples all drop; at 0.15 most keep the call and truncate the result. That is evidence for testing 0.15, **not** evidence to use it as Tau's default or on OpenAI.

## 1. State builder

### Source transcript and mapping

Use `compaction.messages` as the canonical ordered source. Pi's hook contract says these are the model messages for the entries being summarized; `entries` are the active entries before `firstKept`. Prefer the supplied messages over rebuilding directly from `EntryRecord.model`, because the flattened model context can include context edits/order handling that raw entry payloads do not express. Use `entries` only for correlation/diagnostic metadata if a mapping can be proven; do not let that mapping change the message order or contents.

This plan defines **pre-cut conversation** as the message range Pi passes to `beforeCompact`—the range that the summary replaces. The goal is intentionally prefix-only: the live tail/current intent is invisible to this hook, a HookApi limitation, but Pi preserves that tail verbatim. Accept this bounded risk and revisit it only if memory-QA shows misses; do not add tail-reading plumbing pre-emptively.

Normalize the ordered Pi `Message[]` into a serializable state shaped like:

```ts
{
  context: STATE_CONTEXT,
  goal: "up to three user prompts, verbatim; empty when the prefix has none",
  history: [
    {
      i: 4,
      role: "assistant",
      text: "visible assistant text, unchanged",
      tool_calls: [
        {
          id: "t1",
          tool: "Read",
          input: "{\"file_path\":\"src/a.ts\"}",
          result: "ok, 4213 chars (omitted)"
        }
      ]
    }
  ]
}
```

Rules for building it:

- Keep visible user and assistant text in order and verbatim in the initial history. Do not score ordinary text messages.
- Pair assistant `toolCall` blocks to `toolResult` messages by call ID (`toolCall.id` / `toolResult.toolCallId`), not by adjacency or by assuming one tool call per entry. This handles multiple calls in one assistant message and results in separate entries.
- Put the paired call and its result note on the call's history entry. Replace result content with a note such as `ok, N chars (omitted)` or `error, N chars (omitted)`; never put raw tool-result text in the decision state. The result size is derived from visible result text; handling of non-text result blocks is an explicit spike item below.
- Include tool name and serialized arguments in the call record. A call without a matching result is not a scoring candidate; represent it as `pending` and retain it unchanged in the output. An orphan result with no call is malformed input; fail open rather than write a summary with an orphan.
- Exclude system and reasoning/thinking content, matching Pi's transcript serialization. Do not silently discard other multimodal blocks: until their state/output representation is agreed, either use an explicit type-only marker or fail open to Pi. Never send image payload/base64 as a substitute for a tool-result size note.
- Existing compaction summaries and their old `decisions:` lines are ordinary visible message text when they occur in this range. Do not parse historical diagnostics as new decisions.
- Build the goal deterministically from **up to** the last `N=3` visible `role: "user"` prompts in the supplied pre-cut messages. Exclude `toolResult`; do not trim, summarize, infer, or truncate prompt text. With one or two prompts, use those; with zero prompts, use `goal: ""` and proceed with history alone—history-only is still better than bare-item input, and lack of a goal is never a reason to fall back. Use explicit separators so prompt boundaries are unambiguous. The goal is repeated in history where applicable; that extra cost is included in fitting. Keep the goal field verbatim through every fitting stage.

### Pinning

Keep the existing `preserveRecentMessages=6` default. Pin the first and newest six **messages** in `compaction.messages`, not six `EntryRecord`s. A call is pinned (and receives no questions) if either its call or its result is in a pinned message. Pinned exchanges are retained whole in the summary. Free-standing user/assistant text is always retained whole, whether pinned or not.

Pinning controls decisions, not the request-state fitting budget: the state may abridge a pinned message's history copy only after older unpinned text, as upstream does. It never changes the goal, the original Pi messages, or the summary output.

### Exact fitting ladder

Fit only the decision payload. No fitting-stage edit changes the message list or the Pi summary. Build a fresh logical state and stop at the first stage under the backend budget:

1. **Initial state:** serialize each call's arguments as JSON and cap that per-call input text at 1,000 characters. Build all ordered history entries, replacing tool results with size notes. If this fits, use stage `full`.
2. **Smaller inputs:** rebuild from the original messages with the per-call input cap at 200 characters. If it fits, use `inputs<=200`.
3. **Smallest structured inputs:** rebuild with the per-call input cap at 60 characters. If it fits, use `inputs<=60`.
4. **Abridge long message text:** for each text longer than 590 characters, retain the first 400 characters and last 150 characters around `[… N chars omitted …]`. Process old unpinned messages oldest-first, then pinned messages; check the budget after each change. If it fits, use `texts abridged`.
5. **Collapse old text:** oldest-first, replace non-pinned message text with `[… N chars omitted …]` until it fits. Do not collapse pinned text. If it fits, use `old messages collapsed`.
6. **Compact old calls:** oldest-first, replace non-pinned structured calls with one line per call, preserving call ID, tool name, a whitespace-collapsed/truncated input, result status, and result character count (for example `t12 Read file_path=src/a.ts → ok 480ch`). If it fits, use `old calls compacted`.
7. **Leave out old call-less messages:** remove non-pinned history entries with no call, oldest-first, until it fits. This removes them from the decision state only, not from the returned summary. If it fits, use `old messages left out`.
8. **Fold old call-only runs:** merge adjacent, non-pinned, call-only entries of the same role into one history entry while retaining every call line/ID. If it fits, use `old calls merged`.
9. If still too large, mark the state unfittable and return `undefined` from the hook.

The fixed `context`, the verbatim `goal`, and the JSON envelope are part of every budget check. If the goal alone prevents a fit, do not drop/truncate it to force a request.

### Token estimation and budgets

Port the upstream estimator first, then calibrate its error per backend using response usage when available:

- Estimate the actual serialized state with `estimateTokens(JSON.stringify(state))`.
- Token pieces use `[A-Za-z]+|\d+|[^\sA-Za-z\d]`: an alphabetic run costs one token plus one per six additional letters, digits cost 0.5 each, and each non-whitespace symbol costs 0.9; round up. This intentionally charges JSON punctuation, which simple characters-per-token ratios miss.
- Estimate each history entry from its JSON serialization plus one token for the entry envelope. Estimate each question from its exact serialized request shape. Reserve the upstream 20-token request-envelope allowance, increasing it if live usage shows it is too small.
- `maxStateTokens` applies to the fitted shared state. `maxRequestTokens` applies to the state plus that batch's questions and request-envelope allowance. Keep both state and request estimates in diagnostics.

| Backend | Initial application budget | Known endpoint limits / cap | Decision |
|---|---:|---|---|
| TypeSafe Jev | `maxStateTokens=25,000`; `maxRequestTokens=30,000` | Jev limits are 32k tokens per question and 64k per request (project constraint). | Keep the upstream 25k/30k app defaults, conservatively below both limits. The batcher also caps by the request estimate. |
| OpenAI Decisions | Initially use the same `25,000 / 30,000` app budgets. | The current Create Decision API reference documents `input.maxLength=1,048,576` and 1–400 questions/request, but does not give a Decisions-specific token ceiling. | Do not infer an endpoint token allowance from GPT-6 Luna's general model context. Keep the conservative shared budget pending live verification; enforce the documented 400-question cap and an input-length guard. |

The OpenAI `maxLength` is a string-length constraint in the API schema, not a token budget. The spike must confirm how the live endpoint treats large serialized state, the effective token limit, and the length unit. TypeSafe's maximum question count is not documented in the sources read; its 30k token budget is the initial guard, and question-count/rate behavior is a spike item.

If fewer than one complete call/result question pair fits in a request, fail the whole attempt and fall back. Never split one call's two questions across requests. Batch greedily by question-pair token cost; OpenAI batches must also stay at or below 400 questions. Requests repeat the same fitted state. Concurrent batches may be used as upstream does, but concurrency/rate-limit behavior is measured before fixing an unbounded fan-out policy.

## 2. Per-call questions and verdicts

### Shared input, item-specific questions

Do **not** keep sending `frame.callText` or `frame.resultText` as separate per-question inputs. Build one fitted state containing the goal and whole pre-cut history, then send that exact state with every question batch. The individual call and input already appear in history; its result appears as a size/status note. Each question's static instructions identify the call ID, tool, and result size/status, and ask one distinct keep question. Do not duplicate raw result text in question instructions.

This matches the reference: a single shared `state`/`input` is evaluated by multiple questions. It also fixes the missing goal/history without making every request a different `state = item + goal` fragment.

Suggested question names and meaning:

- `call_tN`: Does knowing that this specific call was made, including its input, still matter in the post-compaction active context?
- `result_tN`: Does the full output of this specific call still need to remain verbatim in the post-compaction active context?

The vendor-core wording in the reference is: “A coding assistant conversation is being compacted to free context. `history` is the whole conversation so far, oldest first; tool outputs are replaced by a short `result` note and long texts may be abridged. Each question asks whether one tool call, or the full output of that call, still needs to stay in the history verbatim. Whatever is not kept is deleted permanently, but the assistant can always re-run a tool or re-read a file.” Use the same static framing, but adapt the last sentence for Pi: a `no` removes material from the active post-compaction context; the original durable entries may still be stored, but the model cannot rely on them being available, and rerunning side-effectful tools is not always safe. The goal is always extracted verbatim from user messages, never generated by an LLM.

### Batch client contract and wire shapes

Replace the internal single-predicate-only boundary with a batch operation over one shared state and named questions, returning a score map. The proposed seam in `packages/core/src/decisions/client.ts` is:

```ts
import type { CompactionState } from "./state";

export interface DecideQuestion {
  readonly name: string;
  readonly instructions: string;
}

export type ScoreMap = ReadonlyMap<string, number>;

export interface DecideClient {
  readonly id: "typesafe" | "openai";
  check(): Promise<Availability>;
  judge(state: CompactionState, questions: readonly DecideQuestion[]): Promise<ScoreMap>;
}
```

`CompactionState` is a type exported by the new `packages/core/src/decisions/state.ts`. That module owns Pi-message normalization, goal/history construction, the fitting ladder, and token estimation; it also returns the paired call records/IDs needed by the hook. It does not own verdict policy. `typesafe.ts` and `openai.ts` own only their batched wire-shape construction and answer parsing. `fast-compaction.ts` builds named questions/batches, owns the keep/truncate/drop verdict table in a pure helper, and renders the Pi summary. `fake.ts` implements `judge()` and records state/question batches.

Transport adaptation:

- **TypeSafe:** POST `{ model, state, questions }`; `state` is the structured shared state at the top level, not nested in a question. `questions` is an object keyed by our unique names, each `{ type: "noul", instructions }`. Parse `answers[name].noul` for every expected name.
- **OpenAI:** POST `{ model, input, questions }`; `input` is the JSON serialization of the same shared state, and `questions` is an array of `{ type: "predicate", name, instructions }`. Parse all `answers[]` entries, map the `probability` to the named predicate, and validate every expected answer. The live docs say answers return in question order; use unique names and validate names/order rather than silently taking `answers[0]`.

Pair the two questions for each call in the same batch. A missing, duplicate, malformed, refused, or non-finite answer invalidates the batch. **Do not retry 429 or 5xx responses.** A failed batch immediately fails that backend attempt: discard its partial scores, try the configured fallback backend once from a freshly fitted state, or return `undefined`. This keeps transient throttling from adding unpredictable delay to fast compaction. Record 429/5xx counts and rates in the live spike; only add a bounded retry in a later change if those measurements justify it. Do not construct a partial summary.

### Decision table (reference behavior)

For every unpinned call with a completed result, compare both scores with that backend's calibrated threshold using `>=`:

| Condition | Summary action |
|---|---|
| `keepResult >= threshold` | Keep the call and the full result, regardless of `keepCall`. |
| Else `keepCall >= threshold` | Keep the call; retain the result head plus an explicit truncation note. If the result is too short to reduce meaningfully, leave it whole. |
| Else | Omit the call and its result together. |
| Pinned call/result, or a call without a result | Keep unchanged; do not ask questions. |

Apply verdicts by call ID, including when several calls/results share messages. Never leave a tool result without its call. Render the source user/assistant text in order and verbatim in the returned summary; only paired tool exchanges receive keep/truncate/drop actions. This is summary content for Pi, not a replacement message array.

## 3. Threshold recalibration

### Why the shipped 0.5 evidence does not transfer

`PLAN-jev-compaction.md` records a six-item live calibration per backend, including TypeSafe scores such as `0.8/0.51/0.05/0.21/0.11/0` and OpenAI's near-binary `0.98/0/0/0.02/0/0`. That calibration used the shipped bare call/result text as the input. It did not test the shared conversation state, verbatim recent-prompt goal, vendor-core context, or upstream call/result question framing now proposed. Those numbers cannot justify a threshold for this contract.

The OpenCode report's real TypeSafe old-call scores (`keepCall 0.17–0.23`, `keepResult 0.11–0.14`) show the practical risk: 0.5 would drop all sampled calls; 0.15 would mostly retain calls but truncate their outputs. This is one workload/backend, not Tau's labelled holdout and not OpenAI evidence.

### Calibration protocol and decision

Before setting a new default, calibrate **each backend independently** using the full fitted state, exact batch shape, shared-state prompt, goal, and question wording intended for Tau. Include hand-labelled examples for: must-keep call and result; keep call but result is rerunnable; stale call/result; result contains a fact unavailable elsewhere; and mutating/unsafe-to-rerun tools. The implementer owns and writes the bulk synthetic fixtures. A small set of real threads must come from Pablo, consented and scrubbed; do not source them from arbitrary user logs.

**Blocking input dependency:** the live spike, implementation PR, final calibration, threshold sign-off, and broad rollout are blocked until Pablo provides those real threads. Synthetic fixtures can be prepared for deterministic implementation tests, but synthetic-only results cannot be presented as real-workload calibration or used to declare a threshold validated. Do not discover this dependency after starting the implementation PR.

The threshold sweep must replay scores through the **corrected** verdict table in §2. At `0.15`, a `keepResult` score at/above the threshold keeps the full result even when `keepCall` is below it; under the shipped rule that same case truncates. That region could become common at a lower threshold, so the Zenn report's score/action-rate conclusion and any old Tau score distribution must not be transferred without recomputing actions under the corrected mapping.

For each backend:

1. Run a fixed training corpus and a separate holdout; collect both scores per call, exact resulting action, state-fitting stage, estimated and provider-reported input tokens, number/size of batches, latency, 4xx/429 failures, cost, and reduction ratio.
2. Sweep candidate thresholds including `0.10`, `0.15`, `0.20`, `0.30`, and `0.50`. Evaluate call-retention and full-result recall separately, false drops of labelled facts, action distribution, and bytes/tokens removed. Do not select by score separation or reduction alone.
3. Run post-compaction memory checks against known fixture facts with deterministic answer keys or human review. Do not use a generative model to grade the feature.
4. Select the most aggressive per-backend threshold that meets a pre-agreed retention target on holdout. Start with one threshold per backend applied to both question kinds, matching upstream. Split call/result thresholds only if the labelled evidence shows it is necessary and the policy is reviewed.
5. Keep thresholds as internal per-backend defaults (test-overridable); do not add a user-facing threshold knob in this fix. If evidence is incomplete, do not claim 0.5 is validated for full state and do not promote the change broadly.

**Decision on 0.15:** include it as a TypeSafe candidate because the OpenCode report gives a concrete reason to test it. Do not adopt it globally or for OpenAI on that evidence alone. Use a per-backend threshold table once Tau's full-state holdout supports values. Threshold choice must be recorded with the corpus/version and re-run when a backend/model generation or prompt contract changes.

The calibration runner reads only already configured credentials through existing resolution; it must never prompt for, print, or persist API keys. Logs contain no authorization data and should avoid dumping full state or user text. The service receives the fitted state, including recent prompts/tool inputs, but not raw tool-result contents; this data-flow expansion should be explicit in beta documentation.

## 4. OpenAI Decisions fit and API concerns

The current OpenAI client already uses the right one-question outer shape—`input` plus a `questions` array—and parses the response's `answers[]` form, but the parser only reads the first answer. The full-state change must retain that exact API shape while batching multiple named questions.

The official Create Decision reference currently documents:

- shared text/image `input` evaluated for every question;
- 1–400 questions per request;
- answers returned in question order, with named predicate probabilities;
- request `usage.input_tokens`;
- `input.maxLength=1,048,576` in the API schema.

It does not publish a Decisions-specific maximum **token** budget. The full serialized state should fit the documented string-length ceiling at the proposed 25k-token state cap in normal cases, but the implementation must also guard the serialized input length and the live spike must verify endpoint behavior. Use 30k estimated total request tokens as the conservative initial application ceiling rather than inferring the Decisions quota from the general model context.

Question-count, account-tier rate limits, 429 behavior, batch concurrency, and the effective input-token limit remain quota concerns. The state is repeated for each batch, and OpenAI usage reports input tokens; cost and p95 latency therefore depend on how many batches a real transcript needs. The spike records these rather than assuming that a large general model context means unlimited/cheap Decisions requests. Any refusal or missing answer in a batch causes an atomic fallback to Pi's built-in path, not a partially applied summary.

## 5. Test plan

All automated tests use fake transports/clients and no external API keys or network.

### State/fitting unit tests

Add focused tests in `packages/core/src/decisions/state.test.ts` for the state builder and fitting module:

- goal extraction: up to three `role=user` prompts in source order, exact whitespace/newlines/punctuation, no 500-character truncation, tool results excluded, one/two prompts used as-is, and zero prompts produces `goal: ""` while still proceeding with history alone; goal stable across fit stages;
- ordered user/assistant text and tool calls; call/result pairing by ID across separate messages and multiple calls in one message;
- tool results represented only by status/size notes, no result body in TypeSafe or OpenAI state; error/empty result and unsupported non-text fixtures;
- pin first/newest six messages and pin a whole call if either side is pinned; plain user/assistant text is never a candidate;
- each fitting stage independently: 1,000 → 200 → 60 input caps; 400/150 head-tail; old text collapse; call one-line form; old call-less omission; adjacent call-only merge; stage name and final estimate;
- goal/fixed envelope too large, a question pair too large, or state still too large returns an unfittable outcome for hook fallback; pinned text may be abridged only after older unpinned text is attempted, and is never collapsed or omitted;
- token estimates on code, JSON, Unicode/non-ASCII, and symbol-heavy inputs; record conservative margin against real usage in the calibration script.

### Decision clients and hook tests

Update `packages/core/src/decisions/decisions.test.ts` with fake fetches that match live shapes exactly:

- TypeSafe multiple named `noul` questions under top-level `state`, and `answers[name].noul` parsing;
- OpenAI multiple named predicate questions in `questions[]`, `answers[]` mapping for more than one response, reordered/missing/duplicate/refusal/malformed answers, and usage handling;
- encoded shared state equality across batches; request/input budgets and OpenAI's 400-question cap;
- fake `DecideClient.judge()` records state plus question batches, never calls a network;
- a 429/5xx causes no retry: discard that backend's partial results, attempt fallback once, and ultimately return `undefined` if no backend succeeds.

Update `packages/core/src/harness/fast-compaction.test.ts` to cover:

- full state and verbatim goal are provided to both question types, with item identity in instructions and no raw result text in state;
- only unpinned, completed tool-call/result pairs are scored; free-standing old user/assistant text survives verbatim; multiple tool calls and result pairing remain atomic;
- all four decision boundaries, especially `keepResult >= threshold` while `keepCall < threshold`, and equality at the threshold;
- pinned exchange keep, keep/truncate/drop output, short result no-op, no orphan results, and `minReductionRatio` computed from the actual rendered summary including wrapper/diagnostic overhead;
- instructions, non-fast mode, no candidates, missing key, abort, timeout, any failed batch, unfittable state, and insufficient reduction all return `undefined`—including overflow—with no throw and no `decline`;
- backend fallback discards partial scores and rebuilds for that backend's budget.

### E2E mocks

Update `e2e/tests/fast-compaction-mocks.ts` and `e2e/tests/fast-compaction.spec.ts`:

- TypeSafe mock accepts a named-question object and returns the exact `answers` object shape; OpenAI mock accepts a named question array and returns the exact `answers[]` shape, including names/probabilities and usage where present.
- Reject old/single-question wrong shapes and unknown question names so a regression fails loudly. Do not make mocks a permissive superset of the live API.
- Assert every batch receives the same fitted shared state, that it contains the goal/history/result-size notes, and that raw result bodies are absent.
- Retain existing summary-placement, drop-all, keep-all/fallback, repeated compaction, and dead-backend scenarios. Add enough scored middle calls to exercise question batching and exact two-question-per-call behavior on both backends.

### Live recalibration script

Add a separate opt-in script (location chosen during implementation) for the protocol in §3. It reads existing credentials without prompting, masks all secret-bearing data, and supports a fake/mock mode. The implementer writes the bulk synthetic corpus; Pablo supplies the required small set of consented/scrubbed real threads. Calibration and threshold sign-off stay blocked until those real examples exist. Never dump full prompts/results to logs. Capture per-backend score/action distributions under the corrected verdict table, fitted-state stage/size, actual usage, requests/batches/questions, latency, cost, 4xx/429s, reduction and deterministic memory-retention checks. It must call only the decision APIs, never a chat/completions/summarization endpoint.

## 6. Rollout and diagnostics

### Rollout choice

Use one atomic implementation PR after a small live spike, rather than partially landing a new state builder before batch clients or mocks. The state builder, batch interface, verdict correction, strict mock shapes, and hook tests are one behavioral contract. No protocol/settings schema changes are needed. Keep fast compaction opt-in and `summary` as the default. Canary the PR on a test/dogfood node with each backend separately before broader release; threshold-only adjustments can be a small follow-up if calibration needs more evidence.

Do not ship the new full-state threshold as “validated” using the old bare-item values. Before enabling it beyond dogfood, attach per-backend holdout results from both implementer-authored synthetic fixtures and Pablo's consented/scrubbed real threads, scored with the corrected verdict table, plus the OpenAI/TypeSafe budget observations. If Pablo's examples are not available, threshold sign-off and broader rollout remain blocked. Preserve the current fail-open behavior during rollout.

### `decisions:` diagnostics and in-flight work

Keep the `<fast-compaction ...>` marker and `decisions:` prefix so existing searches and tests remain easy to update. Version new lines explicitly, for example:

```text
decisions: v=2 call=t12 keepCall=0.18 keepResult=0.12 action=truncate
```

Use call IDs rather than entry-frame IDs; include fitted-state stage/token count and batch count in the summary header, but never include the goal, raw tool results, or API keys in diagnostics. Update tests to assert the v2 fields, not the old `frame=... verdict=...` syntax.

Previously stored summaries are immutable: leave historical `decisions:` lines untouched and treat them as ordinary text in future state. An already-running old process/request completes under its old code; a new version does not migrate or reinterpret it. For the new batch path, if one concurrent request fails, discard the whole backend's partial results and fall back to `undefined`, so no mixed-version/partial `decisions:` block is written.

## 7. Spike questions that must be answered

1. **Goal scope (accepted limitation):** The hook receives only the pre-cut messages, so the goal is up to three prompts from that prefix; the live tail/current intent is invisible to the hook but Pi preserves it verbatim. Revisit this only if memory-QA shows misses; tail-reading plumbing is not part of this plan.
2. **TypeSafe batching:** Confirm live acceptance of many named `noul` questions in one top-level `questions` object, practical max questions, request-level limits, usage reporting, and behavior near the 25k/30k app budgets.
3. **OpenAI budget/quota:** Confirm the live Decisions endpoint's effective token limit, interpretation of `input.maxLength`, per-account rate limits, 400-question behavior, refusal handling, 429s, and appropriate batch concurrency. Do not infer these from the model's general context window.
4. **Estimator calibration:** How much does the heuristic under/over-estimate for Tau's code/JSON/Unicode/multimodal histories on each backend? Is the 20-token envelope margin enough after real state and question serialization?
5. **Thresholds:** What per-backend threshold meets holdout retention targets with the actual full state and Pi-adapted questions? Does TypeSafe support 0.15 on Tau fixtures? Does OpenAI need a different threshold? Are separate call/result thresholds justified?
6. **State signal:** Are result size/error notes enough to decide result retention when the state intentionally omits result contents? Are tool inputs capped at 1,000/200/60 still informative for important or mutating calls?
7. **Output economics:** Keeping all old user/assistant text in a Pi summary may miss the 25% reduction floor when text dominates. How often does fast mode then defer to the built-in compactor, and should the floor remain 0.25?
8. **Multimodal content:** How should images or other non-text blocks in user/tool messages be represented in state and in a summary string? Until semantics are safe, should any such case immediately fall back?
9. **Data flow:** Is sending all pre-cut user/assistant text and tool inputs to the selected decision vendor acceptable for the opt-in beta, given that raw result bodies are excluded but the payload is larger than the current bare-item request?

## References

- Shipped Tau plan and recorded bare-item spike: [`PLAN-jev-compaction.md`](PLAN-jev-compaction.md)
- Current hook: [`packages/core/src/harness/fast-compaction.ts`](packages/core/src/harness/fast-compaction.ts)
- Current backend contracts: [`packages/core/src/decisions/client.ts`](packages/core/src/decisions/client.ts), `typesafe.ts`, `openai.ts`
- Original algorithm README: [tamaratran/fast-jev-compaction — How it works](https://github.com/tamaratran/fast-jev-compaction#how-it-works)
- Original fitting implementation: [`src/state.ts`](https://raw.githubusercontent.com/tamaratran/fast-jev-compaction/main/src/state.ts)
- Original batching/verdict implementation: [`src/compact.ts`](https://raw.githubusercontent.com/tamaratran/fast-jev-compaction/main/src/compact.ts)
- OpenCode real-score report and vendor-core wording: [zenn.dev/uhu/articles/1007b909714cef](https://zenn.dev/uhu/articles/1007b909714cef)
- Faithful OpenCode port/defaults: [radqnico/opencode-jev-compaction README](https://github.com/radqnico/opencode-jev-compaction#how-it-works)
- OpenAI Decisions guide: [developers.openai.com — Decisions](https://developers.openai.com/api/docs/guides/decisions)
- OpenAI Create Decision API reference (request limits, question count, answers, usage): [Create a decision](https://developers.openai.com/api/reference/python/resources/decisions/methods/create/)
