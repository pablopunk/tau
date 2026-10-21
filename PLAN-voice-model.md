# Voice model: local Parakeet v3 or provider STT

Goal: a `voiceModel` setting next to default/fast model. Two flavors: **local**
(Parakeet v3 int8, transcribed on the thread's node, model warmed into RAM on
mic press) or **provider** (dropdown, enabled only when a connected provider
offers a known STT model). Composer uses it when set, falls back to browser
SpeechRecognition when unset. Nothing here changes the chat path.

## What the scouts found (decisive constraints)

- `ModelInfo`/`pi-ai` modalities are `text|image` only; no transcription API
  exists in the provider SDK. **But OpenRouter exposes speech models live**
  (proven by nvm's admin, same models as Pablo's screenshot):
  `GET {openrouterBase}/models?input_modalities=audio&output_modalities=transcription`
  returns `{id, name, ...}` rows (voxtral-*, nemotron ASR, parakeet-tdt-0.6b-v3…),
  filterable to input∩audio + output∩transcription. 15-min cache, 24h stale.
  Transcribe via `POST {openrouterBase}/audio/transcriptions` with JSON body
  `{model, input_audio: {data, format}, response_format: "json"}` → `{text}`.
  So the provider dropdown is **live-detected per connected OpenRouter key**,
  not an allowlist. OpenAI direct (`whisper-1`, `gpt-4o-mini-transcribe`,
  `gpt-4o-transcribe` via `POST {base}/audio/transcriptions`, multipart) is
  phase 2 — same endpoint shape, different auth, no catalog to query
  (hardcode the three ids, show only when an OpenAI key is connected).
- webr's recipe ports directly: `sherpa-onnx-node` in a forked worker,
  int8 `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3` (encoder/decoder/joiner +
  tokens.txt) from HuggingFace `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`,
  download-on-first-`warm()`, idle-unload. sherpa resamples internally
  (`acceptWaveform({samples, sampleRate})`), so the client uploads decoded
  PCM at native rate.
- Audio upload copies the image pattern: base64-in-JSON (server rejects
  multipart), new body-limit const (~10MB), thread's node transport
  (`useApi()`), transcribe-and-discard (never written
  to a live doc — first such endpoint). (Proxy needs no manual entry:
  `path-filter.ts` builds its allow-table from the route defs.)
- New setting checklist (17 touchpoints, see plan): protocol field + route +
  Core method + CLI map, core setter + store, server one-liner, web client +
  fake + testkit fake + contract tests, UI row (+ maybe setup step).

## Decisions (locked with Pablo)

1. English-only local model is fine (Parakeet-tdt-0.6b-v3).
2. Provider v1 = **OpenRouter live catalog** (nvm proved the endpoints).
   OpenAI direct is phase 2. Dropdown lists every speech model from every
   connected key that yields one.
3. Local model downloads lazily on first mic press; settings row shows
   missing / downloading / ready plus a delete button.
4. Build order: local Parakeet first (works in every browser, private),
   provider second. Browser SpeechRecognition stays as the unset fallback
   (already shipped in the composer).

## Contract (foundation agent freezes this first)

```ts
// protocol/entities.ts
VoiceModelSettingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("local") }),
  Type.Object({ kind: Type.Literal("provider"), provider: Type.String(), modelId: Type.String() }),
  Type.Null(),
]);
//// Optional like `resources`: absent means "voice unsupported there"; a current node always sends it.
SettingsSchema += voiceModel: Type.Optional(VoiceModelSettingSchema)

// protocol/rest.ts
// (mirror setFastModel: wrapped object, not the bare union)
PUT /api/settings/voice-model {body: {setting: VoiceModelSettingSchema}}
GET /api/voice/options -> { local: {available: boolean,
                                    state: "ready"|"needs-download"|"downloading"|"error",
                                    error?: string},
                             providers: {provider, providerName,
                                         models: {modelId, name}[], error?: string}[] }
POST /api/voice/transcribe {body: TranscribeInputSchema, bodyLimit: AUDIO_BODY_LIMIT(10MB)}
  -> {text: string}
// TranscribeInputSchema (field-level caps IN the schema, not just the route limit):
// { format: "pcm-f32", sampleRate: 8000..192000 number, data: base64 maxLength ~14MB }
// { format: "blob", mimeType: enum(opus/webm, mp4/aac containers), data: base64 maxLength ~14MB }
// Route bodyLimit 10MB is the backstop; the hub proxy buffers the full body
// (no streaming — same as images, acceptable). No temp file: parsed in memory
// only (assert in review; audio is sensitive). Transcribe-and-discard: bytes
// never touch a live doc.
// protocol/core.ts
settings.setVoiceModel(setting: VoiceModelSetting): Promise<void>  // rejects invalid_request (unknown provider model / provider not connected)
// transcribe() dispatches on the STORED setting (like conversations.send uses
// the stored default model). No mode argument: validation at save time and
// behavior at transcribe time can never disagree.
voice: { options(): Promise<VoiceOptions>; transcribe(input: TranscribeInput): Promise<{text: string}> }
```

- Old-node reads: `Settings.voiceModel` is `Optional` like `resources`
  (NOT required like defaultModel — a required field would fail response
  validation against old nodes). Web treats a missing field AND a missing
  route (`nullWhenMissing`, existing pattern) as "voice unsupported there"
  and hides the row. No fake `null` default that means two things.
- Validation (`settings-api.ts`, mirror `setFastModel` BUT against the
  voice catalog, not `provider.lists()` — STT ids are not chat models and
  `lists()` would reject them all): provider flavor requires the provider
  connected AND modelId in that provider's voice catalog (OpenRouter live
  `fetchOpenRouterVoiceModels`, cached; OpenAI hardcoded ×3, phase 2);
  local flavor always accepted (availability surfaces via `voice.options()`).
  Needs a voice-model registry in core (`provider/voice-models.ts`), not a
  `ProviderService` reuse.

## Components

**core**
- `provider/voice-models.ts` (new): `fetchOpenRouterVoiceModels(apiKey)`
  (live catalog query above + modality filter + 15-min in-memory cache per
  Core instance, port nvm's `transcription-models.ts`), `listProviderOptions(connections)`
  returns OpenRouter rows when an OpenRouter key is connected. Cache lives
  next to the connections reader and is dropped on `setApiKey` (key rotation
  must not serve another key's catalog). Fetch failures surface as
  per-provider `error` in options (403/429 included), never throw.
  (Phase 2: append the three hardcoded OpenAI ids when an OpenAI key is connected.)
- `voice/transcriber.ts` (new, port webr's strategy onto WASM): `warm()`
  (download model if needed → start worker → load recognizer into RAM),
  `transcribe(samples, sampleRate)`, idle-unload 5 min.
  Directory: `<node-home>/models/parakeet-tdt-0.6b-v3-int8` (same home root
  as settings-store, so home migration/reset covers it; note ~670MB × nodes).
  Worker is a `worker_thread`: single-threaded WASM decode blocks ~0.4s per
  audio-second and would stall the whole server on long takes. Lifecycle:
  serialized warm (second call attaches to in-flight), transcribe-before-ready
  rejects a named AppError the composer maps to a hint (no queueing),
  idle-unload fires only with refcount 0 AND no in-flight request.
  The worker imports the `sherpa-onnx` WASM binding; model paths cross via
  workerData (plain disk paths, no bundling issues).
  RESOLVED (integration): the Emscripten glue does NOT initialize when bundled —
  `sherpa-onnx` is `neverBundle`d and loaded at runtime via absolute path
  (`Transcriber` resolves it through node_modules in dev, `<versionDir>/sherpa-onnx`
  in compiled installs; `build-binary.ts` copies the package there, `smoke-binary`
  asserts it). The bundled-WASM failure was reproduced and fixed this way; never
  statically import sherpa into the bundle.
  GATE: foundation's first task re-proves `new Worker()` from a version-dir
  sidecar entry under the compiled binary (spike 2); if it fails, fall back
  to in-process transcription with a busy-flag (serializes takes; document
  the loop stall honestly) rather than blocking the project.
- `voice/provider-transcribe.ts` (new): multipart POST to
  `{providerBase}/audio/transcriptions` with connection key, file from blob
  bytes; map failures to `invalid_request`/`internal`.
- `voice-api.ts` (new): `options()` (local availability = WASM binding
  importable + download state [`ready|needs-download|downloading|error` +
  message]; providers = live catalog ∩ connections, each with `error?`),
  `transcribe(input)` dispatches on the *stored* voice setting. Transcribe
  while downloading rejects invalid_request (composer shows "still
d  downloading" hint); transcribe with unset/null setting rejects
  invalid_request (composer keeps browser fallback, never calls this).
- Packaging (SPIKE DONE 2026-10-21, green): `sherpa-onnx-node` (native)
  is OUT — a compiled Bun binary cannot load its `.node` (dlopen fails on
  the bundled copy's missing dylibs). Instead use the pure-WASM `sherpa-onnx`
  npm package (JS + ~15MB `.wasm`, zero native code): proven to load AND
  transcribe end-to-end under `bun run` and inside `bun build --compile`
  output (parakeet-tdt-0.6b-v3-int8, 3.5s audio → correct text in ~1.5s,
  single-threaded WASM). So: regular npm dependency, no optionalDeps,
  no sidecar. Model files (~670MB) download at runtime to
  `<node-home>/models/parakeet-tdt-0.6b-v3-int8`, never shipped.

**server**: `register-routes.ts` three one-liners. No manual proxy work:
  `path-filter.ts` builds its allow-table from the route defs automatically;
  note the hub still buffers the full body (no streaming, same as images).

**web**
- `settings/SettingsModels.tsx`: third row — "Voice model", custom row (not
  `ModelSetting`: no thinking level): radio Local | Provider; provider
  `<Combobox>` disabled when `options.providers` empty with hint
  "No connected provider offers speech-to-text"; local line shows download
  state from `options.local.state`. Download progress polls `GET
  /api/voice/options` (new query key + `refetchInterval` while
  `state === "downloading"`). Saves via `api.settings.setVoiceModel`
  + invalidate `queryKeys.settings`. Per-node free via `useApi()`.
  Delete button calls `DELETE /api/voice/model` → `core.voice.removeModel()`
  (matches the removeWorkspace/resetIcon DELETE-shape precedent).
  `setVoiceModel(null)` NEVER deletes bytes — unsetting the default and
  deleting the download are separate operations.
- `setup/ModelStep.tsx`: skip. Discovery path is the settings row only
  (a fresh node has no voice setting and gets no prompt — stated product
  choice, not free friction).
- `composer/use-dictation.ts` + `Composer.tsx`: if `settings.voiceModel`
  set, mic toggle records with `MediaRecorder` (opus/webm, mp4 fallback)
  instead of SpeechRecognition; the existing AnalyserNode glow loop runs on
  the same stream; on stop: decode via `decodeAudioData` (local) or raw blob
  (provider) → base64 → `api.voice.transcribe` on the thread's node →
  append text (existing append path). `warm()` fires on toggle press so the
  model loads while the user talks — warm AND transcribe MUST use the same
  `useApi()` instance per composer mount (switching threads mid-press must
  not warm node A then transcribe on cold node B). Null setting = today's
  behavior, untouched.
- `lib/api.ts` + `lib/transport/fake.ts` + `testkit/fake-core.ts` + contract
  `settings-provider.ts`: mirror the default/fast checklist.

**testkit/contract**: extend `settings-provider.ts` (get/set/validation of
voiceModel incl. OpenRouter-catalog validation against a stub catalog),
fake-core: in-memory voice field + validation mirror + seed knob for
available voice models; `transport/fake.ts` route map additions;
`lib/api.test.ts`-style route-shape test; `SettingsModels.test.tsx` row
(states: no-key disabled, openrouter-key lists catalog models).
Gate e2e on `VITE_FAKE=1` composer test with fake loopback transcribe
(no headed-mic e2e).

## Phases (subagent workflow)

0. **Spike — DONE 2026-10-21, green**: WASM `sherpa-onnx` loads + transcribes
   under `bun run` AND inside `bun build --compile` output (evidence in
   commit message scope; probe deleted). No sidecar, no native module.
   Remaining spike 2 (foundation's first task): `new Worker()` from a
   version-dir entry under the compiled binary; fallback in-process +
   busy-flag (serialize takes) if it fails. Shipping the worker needs a
   third tsdown entry + `scripts/build-binary.ts` compile args
   (currently exactly bin.js + watchdog.js) + copy to the version dir —
   foundation implements that alongside the spike.
1. **Foundation**: freeze contract above + stubs + fake; check+test+build
   green. Adversarial review before fan-out.
2. **Parallel**: (a) core local pipeline, (b) core provider path + options,
   (c) web settings row + composer wiring. Owners touch only their files
   (plan lists them); cross-cutting needs go in a note for the integrator.
3. **Integrate + verify**: merge, check/test/build, gate e2e on the
   `VITE_FAKE=1` composer test with fake loopback transcribe (no
   headed-mic e2e), plus unit/contract suites.

## Risks

- Compiled-binary NAPI (spike answers; sidecar fallback ready).
- Model download size (~0.5–1GB first use) — lazy by design; surface state
  in the settings row so it never looks broken.
- Safari `MediaRecorder` gives mp4/aac — fine for provider blobs; local
  path decodes client-side so container never reaches sherpa.
- English-only model (see open question 1).
