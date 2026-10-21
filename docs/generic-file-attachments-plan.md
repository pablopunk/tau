# Generic file attachments — implementation plan

**Status:** plan only; no implementation has started. This plan is ready for user approval. The scope below is locked: this is not a proposal to revisit the product behavior.

## Goal and invariants

Let a user pick or drop any file into a conversation. The browser uploads each non-image file to the node serving that conversation; that node stages it locally and returns `{ name, path, size }`. The conversation message carries the node-local path as text context, never the uploaded bytes or parsed file contents. Existing inline image vision stays intact.

Locked behavior to preserve:

- 5 MiB maximum **raw bytes per file**; no file-count cap (refs are ~100 bytes; the message-body limit governs). Images capped at 16 per message (`MAX_IMAGES_PER_MESSAGE`).
- Staging directory: `TAU_UPLOADS ?? join(tmpdir(), "tau-uploads")`; generated `file-<uuid>.<ext>` names, retaining only a safe original extension; file mode `0600`, exclusive `wx` creation, seven-day lazy expiry.
- All files, including text files, are path-only. No file reader, preview, parser, or inline text extraction.
- Existing inline-image payloads stay as `ImageInput` base64 in the conversation message. Clipboard paste remains images-only. Picker/drop keeps the current `image/*` classifier and image preparation path; everything else goes to the upload path.
- Upload is owner-only. Filenames are untrusted; `Core` validates every staged path is an actual staged file inside the upload directory. Tau does not execute uploads.
- File refs are model-independent; `imagesAllowed === false` only blocks the existing image/vision path.
- Persist `{ name, path, size }` refs for files in the draft, never their 5 MiB bytes. If a ref is expired, return an actionable error and require re-attachment.

## Verified baseline and corrections

I read each cited file before using it. Relevant evidence:

- `packages/protocol/src/entities.ts:328-355` defines the current image base64 limit, eight-image cap, `ImageInputSchema`, and shared message fields. `MAX_IMAGE_BASE64_LENGTH` is a **character** limit, not the new raw-file byte cap. `StartConversationInputSchema` reuses the same fields at `:357-364`, so adding optional `files` there also enables file-only first messages.
- `packages/protocol/src/rest.ts:65,70-81,535-557` has the 42 MiB conversation limit, `RouteDef.bodyLimit`, and the current start/send route limits. The new upload gets its own 8 MiB route limit; neither the image limit nor the 42 MiB message limit is the file limit.
- `packages/protocol/src/errors.ts:3-39,86-122` already has `too_large` (413) and `forbidden` (403), but no expiry code. Reuse `too_large`; add `file_expired` only for the distinct actionable stale-ref case.
- `packages/server/src/rest/define-route.ts:11-18,21-40` supports route body limits and an `ownerOnly` registration option. That option is currently outside `RouteDef` and therefore invisible to proxy routing.
- `packages/server/src/nodes/gateway.ts:1-11` confirms the gateway transports an opaque `Buffer`; the destination validates. `packages/server/src/nodes/path-filter.ts:10-25,41-57,101-114` builds its table from `routes`, defaults ordinary routes to 1 MiB, takes a per-route `bodyLimit`, denies `nodes`/`update` etc. but not `uploads`, and caps proxy bodies at `MESSAGE_BODY_LIMIT`. `packages/server/src/nodes/request-responder.ts:66-75` repeats the path/body-limit check at the destination. `packages/server/src/nodes/register-proxy.ts:49-60` parses a raw buffer with the existing 42 MiB transport ceiling and forwards it without JSON parsing.
- **Correction — remote owner check:** applying only `defineRoute(..., { ownerOnly: true })` is not sufficient for `/api/n/<node>/...`. `packages/server/src/nodes/responder-context.ts:12-18` calls the destination loopback with that node's own master token; `packages/server/src/security/guard.ts:114-123` maps that token to `OWNER_DEVICE_ID`. Meanwhile `RouteDef` currently has no `ownerOnly` field (`packages/protocol/src/rest.ts:70-81`) and the proxy path-filter drops the `defineRoute` option. The origin hub must enforce the original browser's owner identity before forwarding. The contract section below adds route metadata consumed by both direct registration and the proxy.
- `packages/web/src/lib/transport/http.ts:49-69,77-84` is JSON-only (`application/json`, `JSON.stringify`, `JsonRouteName`). The `setProjectIcon` client encodes bytes in JSON (`packages/web/src/lib/api.ts:262,323-326`) and the fake decodes base64 (`packages/web/src/lib/transport/fake.ts:57-61`); use the same transport pattern, with a chunk-safe encoder for 5 MiB inputs.
- `packages/web/src/nodes/node-apis.ts:6-17` and `packages/web/src/lib/transport/node.ts:6-17` show that `useApi()` for a thread node prefixes `/api/n/<id>` automatically. Upload through that API; do not add node-selection or SSH logic to the web client.
- `packages/core/src/conversation-input.ts:22-54` currently requires text or images, validates image bytes/capability, and converts only text/images. `packages/core/src/conversations-api.ts:96-115` validates before checkpoint/admission. Extend these paths for refs while leaving image checks model-dependent and unchanged.
- `packages/web/src/conversation/Composer.tsx:157-179,217-229,301-328` shows the current send/restore, image-only paste, and image-only picker gated by `imagesAllowed`. `packages/web/src/conversation/images/use-attachments.ts:20-49` filters image MIME types, enforces the eight-image cap and model gate; `packages/web/src/conversation/images/attachments.ts:41-74` persists image base64 with quota-error fallback. Preserve this image store/path; store file refs separately.
- **Path correction:** the attachment component is `packages/web/src/conversation/composer/AttachmentRow.tsx` (imported from `Composer.tsx:32`), not `packages/web/src/conversation/AttachmentRow.tsx`.
- The webr reference was verified: `~/src/webr/src/server/uploads.ts:6-9,20,35-50` uses a 5 MiB file cap, UUID names, bounded extension sanitation, `0700` directory creation, `0600` `wx` files, and seven-day lazy cleanup. `~/src/webr/src/server/transport/remote-upload.ts:11-20` demonstrates remote staging, but Tau should use its existing node HTTP proxy, not SSH.
- **Layout correction:** the testkit fake is `packages/testkit/src/fake/fake-core.ts` (exported by `packages/testkit/src/index.ts`), not a `fake/index.ts`. `packages/testkit/src/contract/index.ts:49-109` is the shared Core contract registry; `contract.test.ts:7-58` runs it against the fake. The browser fake route dispatcher is `packages/web/src/lib/transport/fake.ts:46-61,250-260`; its node transport targets the selected fake node at `:402-434`.
- **Server layout correction:** REST registrations live in `packages/server/src/rest/register-routes.ts` (called by `create-server.ts`), not a `rest/routes.ts` file.

## Contract to freeze first

### Protocol schemas and route

In `packages/protocol/src/entities.ts`:

1. Add `MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024` and `MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_FILE_BYTES / 3) * 4` (6,990,508 characters at the cap). Keep the image constants unchanged.
2. Add `FileRefSchema` / `FileRef` with `{ name: string, path: string, size: integer }`; bound the returned display name, require a non-empty path, and constrain size to `0..MAX_UPLOAD_FILE_BYTES`.
3. Add `UploadInputSchema` / `UploadInput` with `{ name, mimeType, data }`; bound name/MIME metadata and type `data` as a string. Do **not** make the TypeBox `data.maxLength` equal to the 5 MiB-derived base64 cap: Fastify schema validation maps to `invalid_request` (`packages/server/src/error-handler.ts:3-12`), which would hide the existing `too_large` error for a valid 5 MiB + 1-byte file. The route's 8 MiB body limit bounds JSON; Core strictly validates canonical base64 and enforces decoded raw bytes with `too_large`. `MAX_UPLOAD_BASE64_LENGTH` is the maximum valid encoding for the accepted 5 MiB input and a client-side guard, not the JSON schema's cap. MIME is advisory and does not restrict accepted content. Zero-byte files are valid.
4. Add optional `files?: FileRef[]` to the shared `SendMessageFields`, which covers both send and start. Do not add an unagreed file-count cap. The existing `MAX_IMAGES_PER_MESSAGE = 8` remains image-only.

In `packages/protocol/src/rest.ts`:

- Add `UPLOAD_BODY_LIMIT = 8 * 1024 * 1024`; the maximum base64 payload plus bounded JSON metadata fits below it.
- Add JSON route `stageUpload`: `POST /api/uploads`, status `201`, body `UploadInputSchema`, response `FileRefSchema`, body limit `UPLOAD_BODY_LIMIT`, and owner-only metadata.
- Add optional `ownerOnly?: boolean` to `RouteDef`. This metadata is necessary so `path-filter` can enforce the same route policy at the public hub proxy. Preserve the existing `defineRoute` option for callers that have not migrated; `route.ownerOnly || options.ownerOnly` must still enforce the route.
- `RouteDef` and the route body/response remain TypeBox-driven; no binary route or transport change.

In `packages/protocol/src/errors.ts`:

- Reuse `too_large` (413) for decoded files over 5 MiB and over-limit upload bodies.
- Add `file_expired` with HTTP 410 for a well-formed staged ref whose file is gone or past retention. Its message must tell the user to attach the file again. Invalid/out-of-root refs remain `invalid_request`; do not add `file_too_large`.

### Core staging and message context

Add a small `packages/core/src/upload-store.ts` service, initialized once by `createCoreWith` and exposed as `Core.uploads.stage(input: UploadInput): Promise<FileRef>`. Inject the same store's validator into `createConversationsApi` / the conversation starter rather than teaching Fastify to manipulate files.

Store behavior:

- Resolve the root from the injected environment (`deps.env.TAU_UPLOADS ?? join(tmpdir(), "tau-uploads")`), create it recursively with mode `0700`, and return absolute canonical paths.
- Sanitize the original name for display: strip path components for both `/` and `\\`, control characters, and unsafe length. Derive only the safe trailing `.[A-Za-z0-9]{1,10}` extension (lowercase, as in webr); no safe extension means no suffix. Never join the untrusted name into the path.
- Strictly decode canonical base64; reject malformed data with `invalid_request`; reject decoded bytes over 5 MiB with `too_large`. Create `file-${randomUUID()}${extension}` with exclusive `wx` and mode `0600`. If a UUID collision returns `EEXIST`, generate another UUID; never overwrite. Clean up a partially written file on write failure.
- Validate refs by requiring an absolute path that resolves to a direct child with the generated filename pattern; use `relative`/`realpath` and `lstat` (regular file, not symlink) to prevent prefix, traversal, and symlink escapes. Verify the on-disk size equals `FileRef.size` and is within the cap. Do not read file contents during message validation.
- Lazy cleanup only: no background timer. On staging, sweep only matching generated names and remove files older than seven days by `mtimeMs`; skip symlinks and unrelated directory entries. On validating a referenced file, check its own age/existence and return `file_expired` if gone/expired. Cleanup is best-effort and must not convert an otherwise successful stage into a failure. Concurrent uploads of identical content are separate refs by design; UUID + `wx` prevents clobbering. Removing a composer chip only detaches the ref; the staged file remains until lazy expiry (there is no delete/read route).

In `conversation-input.ts` / `conversations-api.ts`:

- `requireContent` accepts non-empty `files` as content. Keep `requireImagesAllowed` and image signature checks scoped to `images` only.
- Validate all refs before any side effect/admission in both `start` and `send`; reject the whole message if one ref is invalid or expired. Files therefore work with text-only models and do not need a vision capability.
- `toUserInput` leaves the existing output byte-for-byte equivalent when `files` is absent. With files, append one generated text block containing quoted/sanitized name, canonical node-local path, and size plus an explicit note that file contents are not embedded. Preserve existing `ImageContent` blocks as base64 images. If text is blank but files are present, the path block itself is message content. Never call `readFile` or inline uploaded text.
- File-only thread starts should not inherit the current blank-text title `Image`: retain `Image` for image-only starts, and use the first sanitized file name (capped using the existing title rule) for file-only starts. Preserve normal text titles.
- Add `files` to `PendingFirstInput` in `packages/core/src/harness/conversation-docs.ts`; it currently stores only text/images/requestId (`:40`) and `resumePendingStarts()` resubmits it (`conversation-start.ts:152-167`). Make the field optional when reading old documents. Revalidate refs before re-admitting a pending start. If expiry prevents recovery, clear the pending marker and mark that start failed rather than logging/retrying the same stale pending input forever; the browser's retry must receive the normal `file_expired` error.
- Pass refs through both durable conversation paths (`conversation-start.ts` and `conversation-store.ts`) so the first message and later messages receive the same generated context. Files remain only path context after admission; no upload bytes are persisted in Pi Durable.

### Server route and remote-node behavior

- Register `routes.stageUpload` in `packages/server/src/rest/register-routes.ts` as a thin call to `core.uploads.stage(body)`. The server validates the TypeBox body and delegates all decoding, path, permission, and expiry logic to Core.
- Make `defineRoute` enforce `options.ownerOnly || route.ownerOnly`. Add route metadata to `path-filter`'s HTTP `ProxyTarget`, derived from the same frozen `RouteDef` entry. In `register-proxy.ts`, reject `ownerOnly` requests unless the original hub request has `request.deviceId === OWNER_DEVICE_ID`, using `forbidden`, **before calling the gateway**. Keep the destination `defineRoute` owner check as defense in depth; the destination responder's loopback uses that node's master token.
- `/api/uploads` is not in `DENIED_FIRST_SEGMENTS`; the route table already picks route-specific limits. Add an early route-aware owner check before parsing and a `preParsing` byte-count guard driven by `filterProxyPath(...).target.bodyLimit`; keep the existing handler length check as defense in depth. This prevents the generic proxy parser's 42 MiB ceiling from buffering an over-8-MiB upload before rejecting it, while leaving large conversation routes at 42 MiB. The destination responder checks the same limit before its loopback call. Keep `PROXY_BODY_LIMIT_MAX` / `MESSAGE_BODY_LIMIT` at 42 MiB; do not widen the transport maximum. Test both declared `Content-Length` and chunked over-limit bodies, ensure neither reaches the gateway, and prove valid 5 MiB file uploads still pass.
- The route is ordinary JSON end-to-end: the client sends `{ name, mimeType, data }`; the hub and node gateway pass the raw body; the destination validates the schema and Core stages bytes on that destination node. No special remote upload implementation or SSH call.

### Web upload and composer flow

- Add `Api.uploads.stage(file: File): Promise<FileRef>` in `packages/web/src/lib/api.ts`. Reject `file.size > MAX_UPLOAD_FILE_BYTES` locally with `AppError("too_large", ...)` before allocating/encoding; Core independently enforces the same cap. Convert `File.arrayBuffer()` to base64 using a chunk-safe encoder (not a giant spread/argument list); call `request("stageUpload", { body: { name: file.name, mimeType: file.type, data } })`. `HttpTransport` remains unchanged and JSON-only.
- Add a separate `conversation/files/attachments.ts` and `use-file-attachments.ts`. Persist only `FileRef` values under a separate composer key; validate stored shapes on load; follow the existing in-memory fallback if storage is unavailable/quota-limited. Do not store `File`, `Blob`, `ArrayBuffer`, or base64 for generic files. A persisted ref may become stale after seven days; leave it visible until send, then show the Core error and let the user remove/re-attach.
- Keep the existing image hook/store (`images/use-attachments.ts`, `images/attachments.ts`) and image thumbnail behavior. Split paste from drop/pick so `onPaste` only invokes the existing image preparation path. Never send a pasted non-image to the new upload endpoint.
- For picker/drop, keep the existing `file.type.startsWith("image/")` classification: image MIME types continue through the unchanged `prepareImage` → `ImageInput` path (supported PNG/JPEG/WebP/GIF stay inline; unsupported image types retain the current rejection). Route every non-image selected/dropped file through `Api.uploads.stage`. Pasted image files continue through the same existing image path; no pasted file enters generic upload.
- Always show the file picker/drop affordance outside bang mode, independent of `imagesAllowed`; remove the image-only picker `accept` restriction. In a mixed drop, stage generic files even if the current model disallows images; reject/toast only the image branch. `imagesAllowed` still blocks inline images only.
- Render image thumbnails as today and file refs as accessible shadcn `Button`/`Badge` chips (name and size, remove action) in the actual `composer/AttachmentRow.tsx`. Keep all UI built from `packages/web/src/components/ui` components.
- Disable send while preparation/staging is in progress. Upload each file independently (serially per selection is sufficient to avoid a burst of 5 MiB base64 bodies); append results against the latest attachment state so overlapping selections do not lose refs. Duplicate selection is allowed and produces independent UUID refs; failed items toast individually while successful items remain attached. Removing a chip only drops its draft ref; the file is reclaimed by lazy cleanup.
- On submit, pass optional `files` alongside existing `images` through `ComposerProps.onSend`, `useConversationActions`, and `NewThreadPage.start`. Snapshot and clear both attachment stores; if message admission fails, restore text, images, and file refs. A `file_expired` failure must be visible/actionable and must not silently discard the draft.
- For older linked nodes that lack `stageUpload`, display an explicit “this node needs an update to accept file uploads” message; do not silently send a local path to a different node. `scopeTarget` already scopes composer drafts to the current node.

## Fake and contract-test strategy

### Foundation fake

- Extend the `Core` contract with `uploads.stage`; the testkit fake returns deterministic, UUID-shaped virtual paths and tracks refs in memory (not bytes). Validate that refs came from the fake stage map, including missing/expired/outside-root cases. Extend fake message composition to add the same path-only context and accept files with a text-only model.
- Add `packages/testkit/src/contract/uploads.ts` and register it in `packages/testkit/src/contract/index.ts`. The fake Core contract runs all modules (`packages/testkit/src/contract.test.ts:7-58`); add `uploads` to `packages/core/src/contract-basics.test.ts` so the same cases run against real Core (`:5-18`). Give each real contract target a `TAU_UPLOADS` directory under its temporary root and let its existing `dispose()` remove it.
- Contract cases: stage a `.p12`; accept an empty-text/file-only start and send; show the path in user context but never the sentinel file bytes; text-only model accepts `files` while still rejecting unsupported `images`; reject a ref outside the stage directory; reject a valid-shaped missing ref with `file_expired`; enforce the 5 MiB raw-byte boundary and `too_large` above it; preserve current image-only behavior.

### Focused package tests

- Core `upload-store.test.ts`: default/override root, canonical base64, 0/5 MiB and over-cap boundaries, generated/sanitized extension, file and directory permissions, exclusive concurrent writes, partial-write cleanup, seven-day lazy expiry, cleanup ignores unrelated/symlink entries, direct-child/realpath/symlink attacks, size mismatch, and stale refs. Extend `conversation-input.test.ts` for file-only content, path-only conversion, mixed files+images, and unchanged image conversion; extend `conversation-store.test.ts` to prove an expired pending first input is cleared/failed rather than retried forever.
- Server: route body/response schemas, owner-only local route, hub proxy owner rejection without a gateway call, owner proxy success, per-route 8 MiB target limit, too-large request not forwarded, and an integration request proving a remote upload is staged on the destination node. Extend `path-filter.test.ts` to assert `/api/uploads` is allowed with `UPLOAD_BODY_LIMIT` and owner metadata.
- Web: `Composer.files.test.tsx` for picker/drop, mixed image+file, image-disabled model still attaching files, paste non-image never uploading, pasted image staying inline, file refs in send/start payloads, removal, failure restore, and stale-ref error. Extend image tests to prove the same base64 payload and paste behavior. Test file-ref persistence across module reload and assert the stored JSON contains only `{name,path,size}` (no `data`/bytes). Test `createNodeTransport`/fake node flow so the upload lands on the thread's selected node.
- Browser proof after integration: run fake web with `VITE_FAKE=1 mise exec -- pnpm --filter @tau/web dev`, use `?fake=ready&nodes`, attach a `.p12` on a remote-node thread and verify the returned path belongs to that node's fake Core; attach a supported image and verify the existing image thumbnail/vision path. Then run the built app against two real linked nodes and confirm the staged file exists only on the target node with mode `0600`, is readable by the agent at the returned path, and is not executed or sent inline.

## Rollout and ownership split

API changes are additive (`files` optional, new JSON route). Build and ship web/server/core together. An older remote node returns 404 for `stageUpload`; the web must explain that the node needs an update. Existing image-only calls and drafts remain valid. Existing pending-start documents without `files` remain readable.

Follow the repository's foundation-first workflow; do not start parallel implementation until the contract/fake freeze passes.

1. **Foundation / protocol+testkit owner** — owns only:
   - `packages/protocol/src/entities.ts`, `rest.ts`, `errors.ts`, `core.ts`;
   - `packages/testkit/src/fake/fake-core.ts`, `fake-conversation.ts`, `packages/testkit/src/contract/index.ts`, new `packages/testkit/src/contract/uploads.ts`, and `packages/testkit/src/index.ts` only if an export is needed.
   - Freeze the `FileRef`/`UploadInput` schemas, route key/path/body limit/owner metadata, error code/status, `Core.uploads` signature, and fake behavior. Add the shared Core contract. The foundation is done only after check, test, and build pass. No other agent edits these files.

2. **Core owner** — owns only `packages/core`:
   - New `src/upload-store.ts` and `src/upload-store.test.ts`;
   - `src/create-core.ts`, `src/conversations-api.ts`, `src/conversation-input.ts`, `src/conversation-input.test.ts`;
   - `src/harness/conversation-docs.ts`, `src/harness/conversation-start.ts`, `src/harness/conversation-store.ts`, `src/conversation-store.test.ts`;
   - `src/conversation-title.ts` (title assertions live in `src/conversation-input.test.ts`);
   - `src/contract-target.ts`, `src/contract-basics.test.ts` for the real contract target.
   - Implement storage, validation, path context, pending-start preservation/recovery, and tests. Do not edit protocol, testkit, server, or web; send contract mismatches to the integrator.

3. **Server owner** — owns only `packages/server`:
   - `src/rest/define-route.ts`, `src/rest/register-routes.ts`, and a focused new `src/rest/uploads.test.ts`;
   - `src/nodes/path-filter.ts`, `src/nodes/path-filter.test.ts`, `src/nodes/register-proxy.ts`, existing `src/nodes/proxy.test.ts` and `src/nodes/link-requests.test.ts`.
   - Implement direct owner-only registration and the owner-aware proxy gate/body-limit proof. Keep all file I/O and business validation in Core. Do not edit protocol/core/web.

4. **Web owner** — owns only `packages/web`:
   - `src/lib/api.ts`, `src/lib/transport/fake.ts`, and new `src/lib/api.upload.test.ts`;
   - `src/conversation/Composer.tsx`, `src/conversation/composer/AttachmentRow.tsx`, `src/conversation/use-conversation-actions.ts`, `src/routes/NewThreadPage.tsx`;
   - new `src/conversation/files/attachments.ts`, `src/conversation/files/attachments.test.ts`, `src/conversation/files/use-file-attachments.ts`, and `src/conversation/Composer.files.test.tsx`; update `src/conversation/Composer.images.test.tsx` and `src/nodes/two-nodes.test.tsx` for regressions/remote-node proof.
   - Keep `http.ts` JSON-only and preserve the current image helper/storage behavior. Do not edit protocol/core/server/testkit.

5. **Integrator** — merge the foundation first, then Core/server/web branches one at a time; run `mise exec -- pnpm check` and `mise exec -- pnpm test` after each merge, then `mise exec -- pnpm build`. Resolve cross-package changes centrally; agents send notes rather than editing another owner's files. Finish with the browser proof above.

## Repository conventions (required)

- TypeScript strict, ESM only, `import type` for types, small well-named files.
- Expected failures are `AppError` with protocol error codes; REST bodies and WebSocket frames are TypeBox schemas.
- Dependency direction stays `protocol <- testkit <- core/server/web`; Core never imports Server.
- Server stays thin; it validates/funnels the route but owns no upload business logic.
- UI uses `packages/web/src/components/ui` (shadcn first), no one-off styled controls.
- Run package-manager commands only as `mise exec -- pnpm <command>`. `check` is Biome + TypeScript; `test` is Vitest.

## Adversarial self-review

### Pass 1 — routing, authorization, limits, and storage attacks

- **Remote routing is not automatic for all routes:** the proxy derives its exact path table from `routes` and excludes the `nodes`/`update` denylist (`packages/server/src/nodes/path-filter.ts:10-19,49-57,101-111`). `/api/uploads` is therefore eligible, but only with the route's explicit 8 MiB `bodyLimit`. The generic proxy parser currently allows 42 MiB before `proxyHttp` checks the route limit (`packages/server/src/nodes/register-proxy.ts:49-60`, `proxyHttp` at `:25-41`), so the plan adds an early owner gate and route-aware pre-parse byte guard, while retaining the handler check and destination responder check (`packages/server/src/nodes/request-responder.ts:66-75`). Added tests for both fixed-length and chunked over-limit bodies never reaching the target. The transport ceiling remains 42 MiB (`packages/server/src/nodes/path-filter.ts:114`).
- **The TypeBox cap must not mask the too-large code:** the server maps schema validation failures to `invalid_request`, while Fastify body-limit errors map to `too_large` (`packages/server/src/error-handler.ts:3-12`). Therefore the schema bounds the JSON shape, the route body limit bounds total request size, and Core owns the 5 MiB raw-byte error. This lets a valid 5 MiB + 1-byte base64 payload return `too_large` instead of a misleading schema error.
- **Remote owner-only bypass was the strongest issue:** the direct owner pre-handler cannot identify the original browser at the remote node because the loopback is called using the remote node's master token (`packages/server/src/nodes/responder-context.ts:12-18`, `packages/server/src/security/guard.ts:114-123`). The plan now carries `ownerOnly` in the frozen protocol route, propagates it through `filterProxyPath`, and checks the authenticated originating hub request before `gateway.request`; destination enforcement remains as defense in depth (`packages/server/src/rest/define-route.ts:11-18,27-40`).
- **Filename/path attacks:** the webr store generates UUID file names, bounds extensions, uses `wx`, and only cleans names matching its own pattern (`/Users/pablopunk/src/webr/src/server/uploads.ts:20,35-50`). The plan never joins raw names to paths and adds canonical-root, direct-child, `lstat`, symlink, and actual-size checks before message admission.
- **Concurrent duplicate uploads:** the reference uses `randomUUID`, exclusive `wx`, and an independent save per call (`/Users/pablopunk/src/webr/src/server/uploads.ts:1,28-43`). No hash-based overwrite/dedupe is introduced; duplicate selections are independent refs. The existing image hook appends after async work (`packages/web/src/conversation/images/use-attachments.ts:36-49`); the new file hook must append against current state and serialize each selection so overlapping batches neither overwrite nor drop refs.
- **Cleanup safety:** the reference sweeps only names matching its generated pattern by `mtimeMs` (`/Users/pablopunk/src/webr/src/server/uploads.ts:45-50`). The plan keeps deletion lazy and restricted to generated-name files; no timer or broad temp-directory sweep. Validate a particular ref's mtime/existence and return `file_expired`; skip unrelated entries and symlinks. Partial failed writes are removed.

### Pass 2 — stale drafts, vision regressions, and complete user journeys

- **Expired refs in localStorage:** current image storage persists base64 and catches quota failures (`packages/web/src/conversation/images/attachments.ts:26-49`). File refs use a separate, small JSON key and never include `File`/bytes. On send/start, Core validates before admission; the error restores the draft and explicitly asks for re-attachment. Pending first messages currently persist only text/images and recovery catches/logs failures (`packages/core/src/harness/conversation-docs.ts:40`, `packages/core/src/harness/conversation-start.ts:108-112,152-167`); the plan stores optional files there and prevents a stale recovery from remaining pending forever.
- **Vision/paste regression:** `packages/web/src/conversation/Composer.tsx:217-229` filters clipboard files to images before attach; `packages/web/src/conversation/images/use-attachments.ts:20-49` sends `image/*` MIME types through preparation and checks `imagesAllowed`. The plan keeps paste on that exact image-only path, does not upload pasted non-images, preserves base64 `ImageInput`, and keeps the current image MIME classifier. Drop/pick sends only non-image files to staging, so those files still work with `imagesAllowed === false`.
- **LocalStorage quota and reload:** generic refs are only `{name,path,size}` and independently validated on reload; image persistence remains as-is. If browser storage fails, refs remain usable in the current in-memory session, as with the existing image fallback (`packages/web/src/conversation/images/attachments.ts:41-49`).
- **Remote target correctness:** node-scoped `useApi()` is already backed by `apiOfNode` and `/api/n/<id>` (`packages/web/src/nodes/node-apis.ts:6-17`, `packages/web/src/lib/transport/node.ts:6-17`). Uploading through that API, plus the fake-node and two-real-node tests, proves bytes land on the thread node rather than the hub.
- **File-only start and mixed attachments:** `requireContent` currently excludes files (`packages/core/src/conversation-input.ts:22-26`); first-message persistence and title logic also assume text or images (`packages/core/src/harness/conversation-docs.ts:40`, `packages/core/src/conversation-title.ts:1-13`). The plan admits file-only content, preserves `Image` for image-only starts, uses a safe file-name title for no-text starts containing files, and tests mixed image+file inputs without changing image parts.
- **Queue cancellation:** Pi inbox/live summaries currently expose queued text and images only (`packages/protocol/src/live-info.ts:17-22,53-67`). Because the core inserts path context into the queued user text, cancellation restores that explicit path context as draft text; it does not persist file bytes or silently reconstruct a new FileRef. A user can remove/re-attach if the path has expired. This is an intentional consequence of the path-only contract, not a hidden upload fallback.

## Open questions

No user decisions are open. The exact text wrapper for generated path context is implementer-owned, but must quote/escape names and paths and must never include file contents.
