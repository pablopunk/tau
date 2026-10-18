# MVP12 plan: tau reachable from anywhere, with all my machines in one UI

Status: APPROVED v7 (review rounds 1–5 applied). Federation (Stage 2) was proposed by the orchestrator; the user asked to implement all phases, so it proceeds, and the user can still veto it. Federation (Stage 2) awaits the user's OK. Builds on PLAN.md "OpenTunnel" and "Pairing" and on MVP7 (the durable user service). Evidence: `@opentunnel/client` 0.5.2 and `@opentunnel/protocol` (unpacked in `/tmp/ot-inspect`), the guard `packages/server/src/security/guard.ts`, the Multica docs (multica.ai/docs/daemon-runtimes) and the local `multica` CLI.

## Goal

> tau runs 24/7 on a machine (my homelab or a Mac). I open it from my phone or any browser with a link or a QR code. No port forwarding, no account, no DNS. If the server hangs or crashes, it comes back by itself. I can also connect any other server or PC, and see all their threads in the same UI.

## What already exists (do not redo)

- **MVP7**: `tau service install` makes a launchd, systemd user or Task Scheduler service that restarts after a crash and a reboot (`cli/src/service/**`; launchd `KeepAlive` `render.ts:22`, systemd `Restart=always` `render.ts:45` with `RestartSec=5`). `tau status|logs|restart`. `--service` mode exists (`options.ts:11`).
- **Guard** (`security/guard.ts:60-90`): the Host must be in an allow-list (only `127.0.0.1:<port>` and `localhost:<port>`, `allow-list.ts`), writes and sockets need an allowed Origin, and every request needs the master token (Bearer or `?token=`) or its cookie `tau_<port>` (`session.ts:17`). One static token in `<home>/token`; the cookie value is that token.
- The server binds `127.0.0.1` (`create-server.ts:43`). The terminal stream sets `maxPayload` 64 KB on the shared WebSocket server (`terminals/register-stream.ts:7`).

## Scope

Two stages. Stage 2 starts only after Stage 1 passes check, test, build, e2e and a real-tunnel run.

### Stage 1: remote access

1. **Remote switch** (Settings → Remote access, `tau remote on|off|status`): the server opens an OpenTunnel tunnel to its own port. The URL is `https://<hostname>` (route `@`), stable until the user turns remote off or makes a new URL. The tunnel client runs inside the server process (TLS ends in our process; the relay sees no plaintext).
2. **Link a device** (Settings → "Link a device", `tau pair`): a one-time code shown as QR, link and short code. The new device gets **its own session**. Phone, browser, a colleague's laptop: the same flow.
3. **Devices** list (name, kind, last seen, "this device"): rename, revoke, sign out all. Revoke cuts that device's open sockets at once.
4. **Watched server**: `GET /api/health`, a watchdog that kills a hung process so the OS service restarts it, a start log, the last exit reason, a tunnel status. Shown in Settings and `tau status`.
5. **Headless first run**: `tau pair` over SSH enables remote when needed and prints the QR and link in the terminal.

### Stage 2: machines

6. **Connect a machine** (`tau connect <link>` on the machine; Settings → Machines on the hub): any tau server or PC joins the hub with one command. The hub's sidebar groups threads by machine; each machine has its own settings, projects, providers and Claude login, all unchanged.

Out (later plans): a thread that moves between machines; a hub that owns all data with thin runtimes (rejected, see "Why federation"); grouping the same repo across machines; per-machine permissions; PWA, mobile layout and offline caching; other tunnel providers (the remote adapter is a port); LAN mode; per-device scopes; second factor; push notifications; `tau update`; keeping a Mac awake (a note in Settings only).

## Design, Stage 1

### Trust model

- **A public URL is not secret** (certificates go to public CT logs). All defence is in auth.
- **Provenance is the socket, not the header.** The SDK routes by SNI and forwards decrypted bytes unchanged, and the visitor chooses `Host` and `Origin`. A connection is **tunneled** when it arrived on the tunnel listener; headers prove nothing.
- **Tunnel listener**: the route `@` points at a second loopback `net.Server` (`127.0.0.1:<random>`) with `proxyProtocol: "v2"`. It buffers until the full PROXY v2 header has arrived (12-byte signature, byte 12 `0x21` or `0x20`, byte 13 `0x11`/`0x21`/`0x00`, length in bytes 14–15; TCP4 12 address bytes, TCP6 36; the authority TLV `0x02` holds the SNI) with a 5 s timeout, strips it, and tags the socket in a `WeakMap<Socket, { peer, sni }>`. Rules:
  1. A socket whose header is missing, malformed, split past the timeout or without an SNI equal to the tunnel hostname is **destroyed**, never treated as untagged.
  2. Tag first, then `socket.unshift(rest)`, `app.server.emit("connection", socket)` and `socket.resume()` (without `resume()` nothing is read; verified in round 2).
  3. The listener closes together with `app.close()`.
  4. A LOCAL header (no address) uses one shared rate-limit bucket.
- **Guard rules** (`GuardContext`, frozen in Phase 0: `{ session, access: Core["access"], tunnel, hostnames() }`). On an **untagged** socket: as today (master token, loopback Hosts, `?token=`), and device cookies work too. On a **tagged** socket: the only allowed Host is exactly the tunnel hostname (no port, because https `Host` has no port; `<hostname>:443` is refused), the only allowed Origin is `https://<hostname>`, and only a **device cookie** authenticates. The master token and `?token=` are refused.
- **Unauthenticated surface on a tagged socket** is exactly: `GET /pair`, `POST /api/pair/redeem`, `GET /api/health` (`{ ok: true }`, no uptime). Plus, in Stage 2, the machine link (Bearer machine secret on `GET /api/machines/link` with an `Upgrade` header, never a cookie). `/assets/*` and everything else answer 401. `/pair` is served on untagged sockets too (same page).
- **Machine branch of the guard** (Stage 2, specified now so the security suite is written first): order is (1) master token, untagged sockets only; (2) for exactly `GET /api/machines/link` with `Upgrade: websocket`, a rate-limit check by PROXY peer **before** the hash lookup, then `Core.access.verifyMachine(secret)`; success sets `request.deviceId` to the **machine's device id** (not `"owner"`), so revoke closes the link socket through the same `Map<deviceId, Set<socket>>`; (3) a device cookie. A machine Bearer on any other path is 401, and a device cookie on the link is 401. Security suite: machine Bearer on `/api/settings`, `/api/live` and the terminal stream returns 401.
- **A linked device has full power**, terminals and agents included (decision 3). The link dialog says so in plain words.

### Devices and pairing (`core/src/access/**`)

- `Device { id, name, kind: "browser" | "phone" | "cli" | "machine", createdAt, lastSeenAt, current (always `false` for machines), os?, tauVersion?, protocolVersion? }` (`machine` is in the Stage 1 enum so `entities.ts` is frozen once). The secret is 32 random bytes, shown once to the device as its cookie. The store keeps `sha256(secret)` in `<home>/devices.json` (mode 0600, atomic writes). Constant-time compare.
- **Codes**: single use, 5 minutes, in memory (a restart burns them), at most 5 live. A **link code** of 128 bits in the fragment `https://<hostname>/pair#<code>`; a separate **short code** of 8 characters (no lookalikes) typed on `/pair`, with its own limit.
- **Redeem** `POST /api/pair/redeem { code, deviceName }`: needs `Content-Type: application/json` and Origin `https://<hostname>` (or an allowed loopback Origin). Valid: creates the device, sets the cookie, burns the code, emits a `devices` Change. Wrong code: 401, generic text. Failures never burn codes.
- **Rate limit** per **peer address** from the PROXY header (IPv6: /64): 5 failures per minute lock that peer for 10 minutes. A global backstop of 100 failures per minute locks short-code redeem only (link codes stay usable).
- **Cookie** `tau_device` (no port in the name): `HttpOnly`, `SameSite=Strict`, and `Secure` when the socket is tagged. The pair page redeems with `fetch`, then `location.replace("/")` (a same-origin step, so `SameSite=Strict` holds when the link came from another app).
- **Seam** `Core.access { verifyDevice(secret) → Promise<{ deviceId } | undefined>, verifyMachine(secret), touch(deviceId), listDevices, renameDevice, revokeDevice, signOutAll, mintPairing { kind: "device" | "machine" }, redeemPairing }`. `touch` is throttled to once a minute per device. The guard sets a request decoration `deviceId` (`"owner"` for the master token); `registerLive`, `registerTerminalStream` and the machine proxy register their sockets in a `Map<deviceId, Set<socket>>`; revoke closes them, and `/live` subscribe and terminal attach re-check. Mint, list, rename, revoke, sign out all need the owner (master token on loopback, or a linked device). **Sign out all** drops browsers and phones, **not** machines (own button in Stage 2).
- Device names come from the User-Agent ("Safari on iPhone"), editable.

### Pair page

One pre-built inline HTML string in `server/src/security/pair-page.ts` (like `session-start-page.ts`), owned by the server owner. It is the one UI outside the design system, on purpose (the React app needs a session); it uses the app's colour tokens by value. Headers: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-<hash of the exact script text, computed at module load>'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `cache-control: no-store`. A test fails when the script changes without the hash. The script reads `#code`, calls `history.replaceState` to remove it, redeems, and shows a calm error.

### Remote adapter (`core/src/remote/**`)

- Port `RemoteAccess { status, enable, disable, recreate }`; only `core/src/remote/opentunnel-adapter.ts` imports `@opentunnel/client` (Biome `noRestrictedImports`, like pi-env). A fake adapter for tests.
- `enable()`: `ensure` then `connect({ routes: { "@": "127.0.0.1:<tunnelPort>" } })` with `proxyProtocol: "v2"` on the route. Storage: a custom `OpenTunnelStorage` under `<home>/remote/` (not XDG), so a scratch home never touches the user's tunnel. If the home is lost the tunnel is orphaned (`remove()` needs its token): documented.
- `disable()`: `close()` then `remove()`. If `remove()` fails (offline) the identity is kept with `pendingRemoval: true` and retried at every start and when the network returns.
- **No automatic re-creation.** After 10 minutes of `reconnecting` the status says so and offers **"Make a new URL"** (`recreate`): it saves the old token under a numbered profile (`tau-<hash>-old-<n>`, one per recreate, each retried until removed) with `pendingRemoval`, creates a new tunnel, **clears all devices and machines** (their cookies and links belong to the old host), and says the user must pair again.
- `Settings.remote { enabled }` (an old `settings.json` loads with it defaulted). On start, enabled → connect with the stored identity.
- Status `off | starting | online | reconnecting | error`, with URL, `since` and a neutral message. Relay error text goes through a new `remote/neutral-text.ts` (the existing `neutralText` is Claude-specific). Offline: `error: "Cannot reach the tunnel service"`, the SDK retries.

### Watchdog, starts, last exit

- The main thread increments a `SharedArrayBuffer` counter every second. A `worker_threads` Worker (an extra tsdown entry `dist/watchdog.js`, started by `new Worker(new URL("./watchdog.js", import.meta.url))`) reads it every 5 s. After 60 s without change it **first writes `last-exit.json` and a log line with synchronous `fs`**, then `process.kill(process.pid, "SIGKILL")`. (`process.exit` in a worker ends only the worker; verified in round 2.) launchd `KeepAlive` and systemd `Restart=always` restart after a signal. **Sleep-safe**: the worker counts consecutive 5 s ticks (monotonic clock) with an unchanged counter (12 ticks), and a gap between ticks above 10 s (the machine slept) resets the count and needs 2 consecutive failing checks afterwards. A pin simulates a paused process.
- Started only in `--service` mode (the flag is read in `serve.ts`).
- `<home>/starts.json` keeps the last 10 start times; 5 starts in 5 minutes → start with `remote` off and say why. `<home>/last-exit.json` holds the previous run's end (`clean`, `watchdog`, `signal`, or `unknown` when a run never wrote its end).
- `tau status` and Settings show uptime, last exit reason and tunnel state.

### Web (Stage 1)

- Settings → **Remote access** (`settings/Remote*`): switch, status chip, URL with copy; "Link a device" dialog (QR from `components/ui/qr-code.tsx`, the link with copy, the short code in big type, a 5-minute countdown, "Waiting for the device…", then "Linked: Safari on iPhone"); Devices list (revoke with confirm, "This device"); remote-off confirmation ("the URL dies and linked devices stop working").
- Light, dark, phone width.

### CLI (Stage 1)

`tau remote on|off|status [--json]`, `tau pair [--name <label>]` (prints link, short code and a terminal QR, then waits for "Linked: …" or times out), `tau devices list|rename|revoke <id>`. `tau pair` finds the running server through `cli/src/lifecycle/port-store.ts` and calls it over loopback with the master token (as `cli/src/commands/client.ts:71`). New routes: redeem and health go in `COMMAND_EXCLUSIONS` with reasons; `remote`, `devices`, `pair` join `COMMAND_NOUNS`; the exact destructive list gains `devices revoke` and `remote off` (the test changes on purpose).

### Packaging

`@opentunnel/client` and its peer `effect ^4` (exact versions) are dependencies of `packages/core` and `packages/cli` and in `neverBundle` (`cli/tsdown.config.ts`). `qrcode` (SVG in `packages/web`, text renderer only in `packages/cli`). Node >=22.19 is already required.

## Design, Stage 2: machines

### How Multica does it (evidence)

A daemon on each computer dials the server (outbound only), registers runtimes, sends a **heartbeat every 15 s** and is offline after missed beats. Runs, tool logins and code stay on the computer. Setup is one command (`multica daemon start`), with `status`, `logs`, `restart`, and a Runtimes page with an online dot and version. We copy: the outbound-only link, heartbeat and online state, one command, a Machines page, execution and logins stay on the machine. We do not copy "the server owns the data": in tau the agent loop is Pi Durable and is welded to the machine's disk.

### Why federation, not "hub owns all data"

`grep` over `packages/core/src`: 11 non-test files use `child_process` and 33 use `node:fs` (git, worktrees, checkpoints, processes, terminals, skills, MCP config, icons, GitHub, the Claude CLI and its login). A hub with thin runtimes means remoting all of it: a rewrite of core. **Federation** needs none of it: **every machine runs a full tau**, and the machine you open (the **hub**: any tau with remote on) shows the others.

- A thread lives on one machine and runs there. The hub shows it and never copies it.
- A machine works alone when the hub is off. The hub going down loses the view, not the work.
- Accepted cost: no "continue this thread on another machine while the laptop is off"; the same repo on two machines is two projects. Both are later work.
- After approval, PLAN.md "Hub + runtimes" is rewritten to this.

### Link

- On the hub: Settings → **Machines** → "Connect a machine": the same link / short code / QR dialog as a device, with the command `npx tau connect <link>` (and `tau connect <short code> --hub <url>`).
- On the machine: `tau connect` reads the hub's name from the link (`https://<hostname>/pair#<code>.<name>`; there is no unauthenticated endpoint that returns it), prints it, asks "Link this machine to <hub>?", then redeems the code (a node `fetch` sends `Origin: https://<hostname>` explicitly and reads `{ secret }` from the JSON response; the code carries its kind, `device` or `machine`, and only a `machine` redeem returns the secret in the body), stores `{ hubUrl, machineSecret, name }` in `<home>/hub.json` (mode 0600). With no running server it starts `serve` in the foreground for the session, or offers `tau service install`. The **server process dials the hub** (`wss://<hostname>/api/machines/link`): one service, watched by the watchdog. `tau connect --name`; the default name is the host name. `tau disconnect` and Settings → "Linked to <hub>" → Disconnect on the machine, "Disconnect" on the hub: both sides can cut it, and a cut closes in-flight streams.
- **Credential**: a machine secret (`kind: "machine"`), hashed in the devices store, revocable in Devices. `Core.access.verifyMachine` accepts it **only** for `GET /api/machines/link` with an `Upgrade` header. The device-cookie path rejects machine secrets and the machine path rejects device cookies (both in the security suite). The link route has its own per-peer rate limit.
- **No loops, no chains** (two-way): `tau connect` is refused when this tau already has linked machines, and a link is refused when this tau has a `hub.json`. A machine never accepts links while it is linked.
- **Hub URL changes** (a "Make a new URL" on the hub): every machine's `hub.json` points to a dead host. They show "Hub unreachable" and the user runs `tau connect` again. (The hub does not push the new URL.)
- Same-Mac test: two scratch homes and ports; `--hub http://127.0.0.1:<port>` is allowed for loopback, so the feature is testable with no tunnel.

### The link carries the machine's own API (no new business API)

- **Where the code lives** : `core/src/machines/**` holds the registry, summaries, heartbeat state and `Core.machines`. The **link client** (dials the hub, calls its own server on loopback with the master token and `Host: 127.0.0.1:<port>`, no Origin) lives in `cli/src/machines/**` and is wired in `serve.ts`, because only the CLI layer knows the bound port and the token. Core never calls its own HTTP server. The link client's calls arrive on the untagged listener, so the master token works.
- **Frames**: one WebSocket per machine on the **single shared WebSocket server** (`@fastify/websocket` owns every `upgrade` on `app.server` and keeps the socket under private symbols, and refuses `noServer`; a second `WebSocketServer` cannot work). So the link is an ordinary route `GET /api/machines/link` (`websocket: true`) that goes through the guard. `maxPayload` is set **once** at registration (`register(fastifyWebsocket, { options: { maxPayload: 1 MB } })`, replacing the assignment in `terminals/register-stream.ts:7`) and the **64 KB input cap is enforced per route** in the terminal-stream and `/live` handlers (a longer frame closes with 1009). TypeBox text frames carry control (`hello`, `request {id, method, path, query, hubDevice}`, `response {id, status, headers}`, `open {id, path}`, `close {id, code, reason}`, `credit {id, bytes}`, `ping`, `pong`); bodies and stream data travel as binary frames with a 4-byte stream id and a flag byte, in chunks of at most 256 KB, so a 42 MB message body (`MESSAGE_BODY_LIMIT`, `rest.ts:47`) and a 5 MB image fit. Stream ids are allocated by the hub only. **Frame size caps**: `ws` delivers any message up to `maxPayload` (1 MB) to the handler, so **the first line of every handler (`/live`, terminal stream, hub-side proxied `/api/m/<id>/live` and terminal stream) checks the raw length and closes with 1009 above 64 KB, before any `toString()` or parse**; up to 1 MB per connection of memory before refusal is accepted. An over-size frame is **refused, never split** (a JSON text frame cannot be split); only binary terminal input may be split by the link client. The chunk size (256 KB), the header size and the cap (1 MB) are constants in `protocol/src/machine-link.ts`, with a test that the cap exceeds chunk plus header. Existing `terminals/stream.test.ts` and `live.test.ts` change with the cap (foundation). Heartbeat: ping every 15 s; offline after 45 s; the UI shows "Reconnecting…" before "Offline". The loopback socket of the link client to its own server sends `Authorization: Bearer` and no `Origin`.
- **Hub proxy** `/api/m/<machineId>/**`: authenticated like any API route (device cookie), then forwards. The path filter (a mechanism, not a wildcard): decode once, reject `..`, `%2e`, `%2f`, `//` and a query string in the path; match method plus the path against the `routes` table templates (`fillPath`) plus the constants `LIVE_PATH` and `TERMINAL_STREAM_PATH`; an explicit denylist for `access`, `remote`, `machines`, `pair`, `health`. The hub never forwards `Host`, `Origin`, `Cookie` or `Authorization` from the browser. Per-route `bodyLimit` (`define-route.ts:12`) is re-applied on the hub. Tests: a denylisted or unknown path answers 403/404 on the hub and on a direct machine. The match is on the **exact method and path** (a trailing path never matches a shorter template). The hub forwards only an allow-list of response headers (`content-type`, `cache-control`, `content-disposition`, `etag`) and drops `set-cookie`, so a machine cannot plant a cookie on the hub's origin.
- **Flow control**: credit-based for **every body and stream** (requests, responses, terminal and `/live` streams). The sender round-robins streams, one chunk each, so a 42 MB body never blocks others; both sides check `ws.bufferedAmount` before sending; the hub caps memory per stream (credit window 1 MB) and closes a stream with 1013 after 60 s without credit. For terminal streams the machine's link client calls `pause()` on its loopback socket when credits run out, so a slow phone slows its own terminal only. `/live` streams also close with 1013 on overflow (the web resyncs on reconnect, `use-changed-invalidation.ts:50`). The hub does not parse request bodies for `/api/m/**`: a raw-buffer content-type parser inside that plugin scope passes bytes through (the machine validates). One stalled stream never stalls the link.
- **Audit and revoke**: the request frame carries a `hubDevice` label that the link client sets as header `x-tau-hub-device`; the machine logs it. Proxied streams are registered in the hub's `Map<deviceId, Set<socket>>`, so revoking a hub device closes its `/api/m/<id>/live` and terminal streams.
- **Version skew**: `protocolVersion` is a **hash** of the `routes` table, the frame schemas and the `Change` union, computed at build time; a test fails when a schema changes and the hash does not (bumping is automatic). Different from the hub's → the machine shows "Update tau on <machine>" with a copyable command, never as online; both versions are shown.

### Web (Stage 2)

- **One provider per machine**: `MachineProvider` owns that machine's `api` (a `Transport` whose `urlFor` adds `/api/m/<id>`, `transport/http.ts:21`), its own `QueryClient` and its own `LiveClient`. Query keys stay as they are and cannot leak across machines, but `lib/queries.ts:42-46` calls the imported singleton `api` inside `queryFn`, so every hook and `queryFn` must read `api` from context (the grep gate enforces it). Components outside one machine's provider (the new-thread project picker, notifications, the Machines page, the command palette) use a **`MachineRegistry`** (`useMachines()`, `useMachineApi(id)`). The **local** machine is a provider with no prefix: today's URLs and behaviour, byte for byte. `app/providers.tsx:16` (`createLiveClient`) becomes per-machine; `use-changed-invalidation.ts` and `use-terminal-changes.ts` read `useLiveClient()` and work unchanged. Drafts and preferences in `localStorage` (14 uses) get the machine id in their keys.
- Numbers: 62 files import `api` (about 101 uses), 33 files use queries, about 117 `queryKey` mentions. A grep gate keeps `import { api }` out of components that sit outside a provider.
- **URLs**: local `/p/:projectId/c/:conversationId[/terminal/:id]`; remote `/m/:machineId/p/:projectId/c/:conversationId[...]`. `lib/paths.ts` is the only builder; `use-open-conversation.ts` and its consumers read `machineId` (extend the MVP11 consumer test).
- **Sidebar**: one group component per machine, each running its queries under its own provider and isolating its errors (one failing machine blocks no other). Header with online dot, collapsible, local first, a machine filter in the search. An **offline** machine shows its last known projects and thread titles from `<home>/machines/<id>/summary.json` (titles and times only, no transcripts), greyed, marked stale, "Offline, last seen 3 h ago"; the cache is written only while the link is healthy and deleted on disconnect. Opening an offline thread shows a calm "This machine is offline" state.
- **Settings → Machines** (Multica's Runtimes page in tau taste; `components/ui/machine-row.tsx`): "This machine" first; rows with name, OS, tau version, online dot, last seen, thread count; actions rename, disconnect, "Open settings". "Settings for <machine>" renders the machine's providers, projects folder, Claude CLI and connectors, but **not** Remote access, Devices or Machines (their routes are denylisted and would show the hub's data). Folder pickers are labelled with the machine name.
- The machine name shows in the thread header and window title when more than one machine is online. Notifications and needs-attention badges aggregate across providers. New thread: the project picker lists projects of all machines; "Add project" asks which machine first.

## Phase 0 pins (foundation runs these; results go in this doc)

Stage 1:
- (a) The SDK in plain Node 22: `create({ store })`, `ensure`, `connect({ routes })` with `proxyProtocol: "v2"`, time to first online, hostname shape; **always `remove()` afterwards** (tunnels do not expire).
- (b) Through the public URL: HTTP GET, a WebSocket upgrade (`/live`), a binary WebSocket (terminal stream), a 5 MB response, 20 parallel requests; the `Host` and `Origin` the server sees.
- (c) Allow-list: exactly the tunnel hostname (no port) passes on a tagged socket; `<hostname>:443` and others are refused; a `Secure` cookie round trip over https.
- (d) Disable then enable gives a new hostname; the old URL stops answering.
- (e) A server restart keeps the URL; the tunnel is back in under 10 s.
- (f) Offline start: the server starts, status `error`, recovers when the network returns.
- (g) Watchdog: a busy-loop test server is killed by `SIGKILL` within the limit with `last-exit.json` written first; assert the signal; `launchctl` restarts it (scratch home and label); check the systemd start-limit defaults on a rendered unit.
- (h) Bundle and install size with the SDK and `effect`; the built `dist/bin.js` works from `npm i -g` of a `pnpm pack` tarball.
- (g2) Watchdog sleep safety: a simulated 30 s process pause does not kill the process; Windows: `RestartOnFailure` restarts after the SIGKILL exit (result recorded, run by the user if no Windows host).
- (j) **Provenance**: the tagged listener works with keep-alive reuse, WebSocket upgrade (`upgrade` event with Fastify and `@fastify/websocket`) and a binary WebSocket through the real tunnel; a malformed or split PROXY header destroys the socket; the PROXY v2 header gives the peer address; a visitor sending `Host: 127.0.0.1:<port>` is still tagged.
- (k) The SDK's `new WebSocket(url, { headers })` works on Node 22 (undici), and `neverBundle` with `effect` works from a packed install.
- (i) A real phone browser through the tunnel (**the user does this one**).

Stage 2:
- (m1) Same-Mac federation spike: two scratch homes, link B to A over loopback, `GET /api/m/<B>/api/conversations`, the `/live` socket and the terminal stream through the proxy, a 5 MB image, a 42 MB message body, 20 parallel requests, kill B and watch A mark it offline within 45 s, reconnect.
- (m2) The link over the real tunnel (wss through the tagged listener, binary frames).
- (m3) Count `import { api }` outside providers and the `localStorage` keys that need the machine id.
- (m4) A stalled browser on a proxied terminal stream does not stall the link or other streams (credit flow).

## Phases and owners

Phase 0 of each stage is **one foundation agent** that owns every seam file; owners fill only their folders and put needed changes in a note for the integrator. Agents run on Sonnet, low effort, in worktrees; the orchestrator commits their work.

### Stage 1

0. **Foundation**: pins (a)–(h), (j), (k); dependencies and `neverBundle`; Biome rule; protocol (`protocol/src/{rest,entities,core,commands,commands.test}.ts`: `Settings.remote` and its migration, `RemoteStatus`, `Device` with `machine`, routes, `Change` resources `remote` and `devices`, commands with the exclusions above); `Core.access` and `Core.remote` for the real core, `faux-core.ts` and the testkit fake, contract tags; `create-core.ts`, `create-server.ts`, `serve.ts`, `options.ts`, `security/allow-list.ts` and the `GuardContext`; and the **security suite extended first** (master token refused on a tagged socket even with `Host: 127.0.0.1:<port>`; a device cookie accepted; forged Host and Origin refused; the unauthenticated surface exact; `/assets/*` 401; tagged-socket destroy rules); stubs for each owner.
1. **Parallel**:
   - **A** `core/src/access/**` (devices, codes, limits, throttled touch).
   - **B** `core/src/remote/**`, `core/src/watchdog/**`, `starts.json`, `last-exit.json`.
   - **C** `server/src/security/**` (tunnel listener and tags, guard, pair page, redeem and health routes, device-bound sockets).
   - **D** `web/src/settings/Remote*` and `web/src/components/ui/qr-code.tsx` (the Remote entries in `settings/settings-index.ts` and `sections.ts`, and the new routes in `lib/transport/fake.ts`, are Phase 0 seams of Stage 1: foundation).
   - **E** `cli/**` command handlers (nothing in `protocol`).
2. **Integration**: notes, wiring, e2e with the fake adapter (turn on, link a second "device" through redeem, revoke, socket cut), then the **real tunnel** on a scratch home and a random port. `check` and `test` after each merge.
3. **Verify for real**: build, run on a scratch home and port, turn remote on, open the public URL in a browser with no cookie (401 page), link with the code, use the app (thread, terminal), revoke, see it cut. The user links their phone from their own tau.

### Stage 2

0. **Foundation**: pins (m1)–(m4); `Core.machines`; `protocol/src/machine-link.ts` frame schemas; the `protocolVersion` hash and its test; routes and commands (`tau connect`, `disconnect`, `machines list`); the `MachineProvider` seam, the path-filter table, the fake core with two machines; contract tag; `serve.ts` wiring against a frozen stub interface `startLinkClient({ port, token, hubFile, core })`; `Core.machines.reportLink(state)` (the link client reports its state to core, which feeds Settings "Linked to <hub>"); one module owns `hub.json` (`cli/src/machines/hub-file.ts`, owner I; `serve.ts` and `tau connect` only call it); the guard's machine-link entry and its security tests; the shared `maxPayload` change and the per-route 64 KB caps, with a pin: a 256 KB frame passes on the link, a 70 KB terminal input frame is refused.
1. **Parallel**:
   - **F** `core/src/machines/**` (registry, summaries, heartbeat state).
   - **G** `server/src/machines/**` (link route on the shared WebSocket server, multiplexer, credit flow, `/api/m/**` proxy, path filter, device-socket registry).
   - **H** web (`MachineProvider`, `MachineRegistry`, per-machine live client and keys, the Stage 2 routes in `lib/transport/fake.ts` and the Machines entries in `settings/settings-index.ts`/`sections.ts`, sidebar groups, Machines page, `machine-row.tsx`, offline state, URLs).
   - **I** `cli/src/machines/**` (link client) and the `tau connect|disconnect|machines` handlers.
2. **Integration**: the same-Mac e2e (two real built servers on scratch homes: link, see B's thread in A's sidebar, send a message through A, see the answer, revoke, disconnect), then the real-tunnel e2e.
3. **Verify for real**: the same flow in a browser on this Mac (two scratch homes); the user connects a second machine of their own.

## Testing

- Core: code single use, expiry with a fake clock, max live codes, per-peer limits, short-code backstop, secrets hashed at rest, constant-time compare, revoke, throttled touch; remote status machine over a fake adapter (offline, reconnect, error, disable, recreate clears devices, pending removal); watchdog (fake clock; a real stuck-loop in a child process asserts the signal and `last-exit.json`); starts log and crash-loop rule; machines registry, heartbeat, offline cache.
- Server: the extended security suite (above); redeem needs JSON and the right Origin; pair page CSP hash test; device secret rejected on the machine route and machine secret rejected elsewhere; revoke closes sockets including proxied streams; tunnel-listener destroy rules; frame schemas, multiplexer ordering, credit flow, version-skew state, path filter (tables of allowed and denied paths), per-route body limits through the hub, a 42 MB body.
- Web: Remote section states, dialog (countdown, linked state), devices list, QR renders the link; two fake machines (grouping, offline state, no cross-machine cache leak, per-machine drafts); consumer test for `machineId` on every URL shape.
- CLI: coverage test, `tau pair` prints a QR and waits, `tau connect` confirm prompt and the two-way loop refusal.
- e2e as in the phases.

## Risks

- **A remote shell on a public URL.** A stolen device cookie equals the user's account on that machine (agents, terminals, the `claude` login), and through the hub on every linked machine. Mitigations: per-device secrets hashed at rest, revoke, `Secure`, one-time short-lived codes, per-peer limits, no master token over the tunnel, socket provenance. Weak spots: no second factor, no scopes (later).
- **OpenTunnel is young** (0.5.2, one relay we do not control). It sees no plaintext, but it can drop or delay. Pin the version; the adapter is a port.
- **Tunnels do not expire and cannot be deleted without their token**: the store lives in `<home>/remote/`; pins and tests must `remove()`; a lost home orphans one.
- **Provenance depends on the tunnel listener**: a bug that tags a loopback socket or leaves a tunneled socket untagged breaks the model; the security suite and pin (j) are the guard.
- **Watchdog false positives** under a long synchronous task on the main thread: 60 s is generous; the reason is logged and stored.
- **The web pass is wide** (62 files use `api`); the per-provider design keeps keys and caches isolated.
- **Protocol skew** across machines is a real support cost; the hash check refuses to mix versions.
- **NixOS and odd hosts**: the user service needs the user manager with linger; the user verifies on the real homelab.
- **A Mac host that sleeps** kills the tunnel; a note, not a fix.

## Decisions

1. **Machines are in this plan** (the user's call). Architecture: **federation** (proposed by the orchestrator, **awaits the user's OK**).
2. The pairing code alone is the approval (no "approve on the host" click).
3. A linked device gets **full power** (terminals and agents included), no scopes. The link dialog says so in plain words.
4. First host to test: the user's Mac (this machine), with a scratch home and a random port for agent runs. The user links their own phone and second machine from their own tau.
