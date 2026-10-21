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
  (`useApi()`), proxy allowlist entry, transcribe-and-discard (never written
  to a live doc — first such endpoint).
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
//SettingsSchema += voiceModel: VoiceModelSettingSchema  // required; old nodes: see below

// protocol/rest.ts
PUT /api/settings/voice-model {body: VoiceModelSettingSchema}
GET /api/voice/options -> { local: {available: boolean, state: "ready"|"needs-download"|"downloading"},
                             providers: {provider, providerName, models: {modelId, name}[]}[] }
POST /api/voice/transcribe {body: {format: "pcm-f32", sampleRate: number, data: base64} |
                                       {format: "blob", mimeType: string, data: base64},
                            bodyLimit: AUDIO_BODY_LIMIT(10MB)}
  -> {text: string}

// protocol/core.ts
settings.setVoiceModel(setting: VoiceModelSetting): Promise<void>  // rejects invalid_request (unknown provider model / provider not connected)
voice: { options(): Promise<VoiceOptions>; transcribe(input): Promise<{text: string}> }
```

- Old-node reads: `Settings.voiceModel` required like defaultModel; web treats
  a missing route (`nullWhenMissing`, existing pattern) as "voice unsupported
  there" and hides the row. No fake `null` default that means two things.
- Validation (`settings-api.ts`, mirror `setFastModel`): provider flavor
  requires the provider connected AND modelId in that provider's live
  catalog (OpenRouter) or hardcoded list (OpenAI, phase 2); local flavor
  always accepted (availability surfaces via `voice.options()`).

## Components

**core**
- `provider/voice-models.ts` (new): `fetchOpenRouterVoiceModels(apiKey)`
  (live catalog query above + modality filter + 15-min cache, port nvm's
  `transcription-models.ts`), `listProviderOptions(connections)` returns
  OpenRouter rows when an OpenRouter key is connected. (Phase 2: append
  the three hardcoded OpenAI ids when an OpenAI key is connected.)
- `voice/transcriber.ts` (new, port webr's strategy onto WASM): `warm()`
  (download model if needed → start worker → load recognizer into RAM),
  `transcribe(samples, sampleRate)`, idle-unload 5 min.
  Directory: `<node-home>/models/parakeet-tdt-0.6b-v3-int8`.
  Worker MUST be a `worker_thread` (extra `bun build --compile` entry —
  watchdog precedent), not in-process: single-threaded WASM decode blocks
  ~0.4s per audio-second and would stall the whole server on long takes.
  The worker imports the `sherpa-onnx` WASM binding; model paths cross via
  workerData (plain disk paths, no bundling issues).
- `voice/provider-transcribe.ts` (new): multipart POST to
  `{providerBase}/audio/transcriptions` with connection key, file from blob
  bytes; map failures to `invalid_request`/`internal`.
- `voice-api.ts` (new): `options()` (local availability = can-resolve
  sherpa module + download state; providers = allowlist ∩ connections),
  `transcribe()` dispatches on the *stored setting flavor* — no wait:
  dispatch on the *request*; the setting only picks the default in the UI.
  Simpler and testable: `transcribe(input, mode)` where mode comes from the
  caller's setting. Keep core stateless here; settings-store only persists.
- Packaging (SPIKE DONE 2026-10-21, green): `sherpa-onnx-node` (native)
  is OUT — a compiled Bun binary cannot load its `.node` (dlopen fails on
  the bundled copy's missing dylibs). Instead use the pure-WASM `sherpa-onnx`
  npm package (JS + ~15MB `.wasm`, zero native code): proven to load AND
  transcribe end-to-end under `bun run` and inside `bun build --compile`
  output (parakeet-tdt-0.6b-v3-int8, 3.5s audio → correct text in ~1.5s,
  single-threaded WASM). So: regular npm dependency, no optionalDeps,
  no sidecar. Model files (~670MB) download at runtime to
  `<node-home>/models/parakeet-tdt-0.6b-v3-int8`, never shipped.

**server**: `register-routes.ts` three one-liners; `path-filter.ts` allowlist +
  body limit for `POST voice/transcribe` (proxy forwards to thread's node).

**web**
- `settings/SettingsModels.tsx`: third row — "Voice model", custom row (not
  `ModelSetting`: no thinking level): radio Local | Provider; provider
  `<Combobox>` disabled when `options.providers` empty with hint
  "No connected provider offers speech-to-text"; local line shows download
  state from `options.local.state`. Saves via `api.settings.setVoiceModel`
  + invalidate `queryKeys.settings`. Per-node free via `useApi()`.
- `setup/ModelStep.tsx`: skip (voice stays unset → browser fallback; no
  setup friction).
- `composer/use-dictation.ts` + `Composer.tsx`: if `settings.voiceModel`
  set, mic toggle records with `MediaRecorder` (opus/webm, mp4 fallback)
  instead of SpeechRecognition; the existing AnalyserNode glow loop runs on
  the same stream; on stop: decode via `decodeAudioData` (local) or raw blob
  (provider) → base64 → `api.voice.transcribe` on the thread's node →
  append text (existing append path). `warm()` fires on toggle press so the
  model loads while the user talks. Null setting = today's behavior,
  untouched.
- `lib/api.ts` + `lib/transport/fake.ts` + `testkit/fake-core.ts` + contract
  `settings-provider.ts`: mirror the default/fast checklist.

**testkit/contract**: extend `settings-provider.ts` (get/set/validation of
voiceModel), fake-core in-memory setting + fake `voice.options/transcribe`
(loopback text), `rest.test.ts` route shape, `SettingsModels.test.tsx` row
(states: none-connected disabled, openai-connected enabled).

## Phases (subagent workflow)

0. **Spike** (one agent, fast): sherpa under bun + compiled binary; report
   which packaging works. Go/no-go for in-process worker vs sidecar.
1. **Foundation**: freeze contract above + stubs + fake; check+test+build
   green. Adversarial review before fan-out.
2. **Parallel**: (a) core local pipeline, (b) core provider path + options,
   (c) web settings row + composer wiring. Owners touch only their files
   (plan lists them); cross-cutting needs go in a note for the integrator.
3. **Integrate + verify**: merge, check/test/build, e2e a real dictation on
   the faux server with a stubbed transcriber? No — verify for real: record
   in-browser against a local node with the real model (needs mic; do it
   headed), plus unit/contract suites.

## Risks

- Compiled-binary NAPI (spike answers; sidecar fallback ready).
- Model download size (~0.5–1GB first use) — lazy by design; surface state
  in the settings row so it never looks broken.
- Safari `MediaRecorder` gives mp4/aac — fine for provider blobs; local
  path decodes client-side so container never reaches sherpa.
- English-only model (see open question 1).
