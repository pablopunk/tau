# MVP12 plan: tau reachable from anywhere (the server everywhere)

Status: DRAFT v3 (round 1 applied; round 2 pending). The section "Round 1 changes" overrides older text where it disagrees. Builds on PLAN.md "Hub + runtimes", "OpenTunnel" and "Pairing", and on MVP7 (the durable user service). Evidence so far: `@opentunnel/client` 0.5.2 and the `opentunnel` CLI README (unpacked in `/tmp/ot-inspect`), the current guard `packages/server/src/security/guard.ts`.

## Goal

> tau runs 24/7 on one machine (my homelab or a Mac). I open it from my phone or any browser with a link or a QR code. No port forwarding, no account, no DNS. If the server hangs or crashes, it comes back by itself.

## What already exists (do not redo)

- **MVP7**: `tau service install` makes a launchd / systemd user / Task Scheduler service with restart after a crash and a reboot (`cli/src/service/**`, `KeepAlive`, `Restart=always` + linger). `tau status|logs|restart`.
- **Guard** (`security/guard.ts:60-90`): every request needs the Host in an allow-list (only `127.0.0.1:<port>` and `localhost:<port>`), a valid Origin for writes and sockets, and a token (Bearer) or a cookie. One static token in `<home>/token`; the cookie value **is** that token, forever.
- The server binds `127.0.0.1` (`create-server.ts:43`).

## Scope

In:
1. **Remote access switch** (Settings → Remote access, and `tau remote on|off|status`): the server opens an OpenTunnel tunnel to its own port. The public URL is `https://<name>.<hostname>`; it is stable until the user turns remote off (off deletes the tunnel; on makes a new URL). The tunnel runs **inside the server process** (`@opentunnel/client`, TLS ends in our process, the relay sees no plaintext). One service, one thing to watch.
2. **Link a device** (Settings → Remote access → "Link a device", and `tau pair`): mints a **one-time pairing code**. The UI shows a QR code, the link, and a short code to type. The new device opens the link, and is signed in with **its own session**. Same flow for a phone, another browser, a colleague's laptop.
3. **Devices** list in Settings (name, kind, last seen, "this device"); rename; revoke one; sign out all. Revoking cuts that device's open sockets at once.
4. **Watched server**: a health route and a watchdog thread (a stuck event loop exits the process, so the OS service restarts it), a tunnel watcher (reconnect, recreate when down too long), and a status line in Settings and `tau status`: server uptime, last restart reason, tunnel state.
5. **Headless first run**: on a server with no screen, `tau pair` over SSH enables remote when needed and prints the QR and link in the terminal. The phone then does the rest (providers, projects) in the web setup.

Out (later plans): **multi-server threads and runtimes** (PLAN.md hub + runtimes: a runtime dials the hub, remote `pi-env`, a thread on another machine, Claude CLI on a connected runtime). This plan only makes the hub reachable and gives every client its own credential; a runtime later is one more **device kind** on the same pairing flow. PWA, mobile layout and offline caching (next plan); other tunnel providers (Cloudflare, Tailscale: the remote adapter is a port, so they fit later); LAN mode (binding `0.0.0.0`); per-device permission scopes; push notifications; auto update (`tau update`); the OS never sleeping (a Mac host may sleep: Settings shows a note, nothing more).

## Design

### Trust model (the main risk)

- **A public URL is not secret.** Certificates for `<random>.<hostname>` go to public CT logs, so scanners find it. The URL must be safe to be known. All defence is in auth.
- **Loopback is not trust.** The tunnel delivers bytes to `127.0.0.1` and "a target cannot tell a tunneled request from a local one" (opentunnel README, trust-boundary note). The guard already needs a token or cookie for everything, so it stays correct, but two rules are added:
  1. The **master token** (`<home>/token`, used by the CLI and the local browser link) is accepted **only** when the request's Host is a loopback name. Over the tunnel Host, only a **device secret** or a pairing code works.
  2. The unauthenticated surface on the tunnel Host is exactly: the pair page (`GET /pair`), `POST /api/pair/redeem`, and `GET /api/health` (returns `{ ok: true }` only). Everything else answers 401 as today.
- **Allow-list becomes dynamic**: the tunnel hostname is added to `hosts` and `https://<hostname>` to `origins` when the tunnel is up, and removed when it goes down (`allow-list.ts`, today fixed by port).
- **Cookies**: `Secure` + `HttpOnly` + `SameSite=Strict` over https; the pair page lands the cookie with the same same-origin page trick as `session-start-page.ts`.
- **A linked device can do everything the user can, including terminals and agents that run commands** (MVP11 risk note: remote needs per-device auth first; this plan adds it). Decision pending (see questions): no scopes now, loud text in the link dialog, per-device revoke.

### Devices and pairing (core, `core/src/access/**`)

- `Device { id, name, kind: "browser" | "phone" | "cli", createdAt, lastSeenAt, current }`. The secret is 32 random bytes shown **once** to the device (cookie value); the store keeps only `sha256(secret)`, in `<home>/devices.json`, private file mode. Constant-time compare (as `session.ts`).
- **Pairing code**: single use, expires in 5 minutes, held in memory (a restart burns them). Link form `https://<host>/pair#<code>` (a fragment: never sent in a request line or referrer). Short form: 8 characters from a no-lookalike alphabet, in groups of 4, entered on `https://<host>/pair`. Several codes can be live (max 5).
- **Redeem** (`POST /api/pair/redeem { code, deviceName }`, unauthenticated, no cookie needed): valid → creates the device, sets the cookie, burns the code, announces a `devices` Change to the owner's open UI ("Pablo's iPhone linked"). Wrong code: 401 with a generic message. **Rate limit**: all peers look like `127.0.0.1` to the server, so the limit is global: 5 failures in a minute lock redeem for 1 minute, and 20 failures burn every live code. (Per-visitor limits need the proxy-protocol listener; later.)
- Device names come from the User-Agent ("Safari on iPhone"), editable.
- **Live cut**: revoke closes that device's `/live` and terminal sockets (a `deviceId` on each connection).
- Mint, list, rename, revoke and sign-out-all need the owner (master token on loopback, or any linked device).

### Remote adapter (core, `core/src/remote/**`)

- A port `RemoteAccess { status(), enable(), disable() }`; **the only file that imports `@opentunnel/client`** is `core/src/harness/` style: `core/src/remote/opentunnel-adapter.ts` (Biome `noRestrictedImports`, like pi-env). A fake adapter for tests.
- `enable()`: `client.tunnel.ensure({ profile })` then `connect({ routes: { "@": "127.0.0.1:<port>" } })`. Profile `tau-<hash of home>`, storage in `<home>/remote/` through a custom store so a `--home` test never touches the user's tunnel and `rm -rf <home>` cannot orphan one. `disable()`: `close()` then `tunnel.remove()`.
- `Settings.remote { enabled }`. On server start, enabled → connect again with the stored identity (the URL is stable across restarts).
- Status: `off | starting | online | reconnecting | error`, with the URL, a message for the error and `since`. Events `connected/disconnected/reconnecting` feed it. No raw error text from the relay in the UI without a `neutralText` pass.
- Requires network to `opentunnel.xyz`; offline → `error: "Cannot reach the tunnel service"`, retried with backoff (the SDK reconnects).

### Watchdog and health (server + cli)

- `GET /api/health` → `{ ok: true }` (exempt from auth, loopback and tunnel). Used by the watchdog, `tau status`, and uptime checkers.
- **Watchdog**: a `worker_threads` Worker started with the server pings the main thread every 5 s; no answer for 60 s → the worker writes "watchdog: event loop stuck" to the log and `process.exit(1)`. Under the MVP7 service the OS restarts it (non-zero exit is already the rule on Windows). Not started for `tau serve` in the foreground.
- **Last restart reason** stored in `<home>/last-exit.json` (`watchdog`, `signal`, `clean`; a crash is "unknown" if the file says the previous run did not exit cleanly) and shown in Settings and `tau status`.
- Crash loop: the MVP7 backoff stays. If the server starts 5 times in 5 minutes, it starts with `remote` **off** and says why (so a bad tunnel state cannot loop forever).

### Web

- Settings → **Remote access** section (`settings/Remote*`): switch with status chip and URL + copy; "Link a device" dialog (QR from a small `components/ui/qr-code.tsx` using a tiny library, the link with copy, the short code in big type, a 5-minute countdown, "Waiting for the device…", then "Linked: Safari on iPhone" and a new code button); Devices list (rows from `components/ui`, revoke with confirm, "This device"); remote-off confirmation that says the URL dies and linked devices stop working.
- **Unauthenticated pair page** served by the server as static HTML on the tunnel Host (not the React app, which needs a session): code entry or auto-redeem from the `#code` fragment, a device name field, a calm error state. Small, no framework, styled like the app.
- Light, dark, phone width.

### CLI

- `tau remote on|off|status [--json]`; `tau pair [--name <label>]` (prints link, short code and a terminal QR, then waits and prints "Linked: …" or times out); `tau devices list|rename|revoke <id>`. REST routes in `rest.ts`, commands table rows, coverage test (the destructive list grows by `devices revoke` and `remote off`: update the exact-list test on purpose). `tau status` gains remote and watchdog lines.

### Packaging

`@opentunnel/client` (peer `effect`) as a dependency of `packages/core` and `packages/cli`, exact versions, `neverBundle` if needed (pin). A terminal QR library for the CLI (small). Runs on the Node versions tau supports.

## Round 1 changes (these override anything above that disagrees)

### Provenance is the socket, not the header (replaces "Trust model" rule 1 and the dynamic allow-list)

- The SDK routes by SNI and forwards decrypted bytes unchanged; the visitor chooses `Host` and `Origin`. So a header proves nothing. **A connection is "tunneled" when it arrived on the tunnel listener.**
- The tunnel route `@` points at a **second loopback listener** (`127.0.0.1:<tunnelPort>`, random) with `proxyProtocol: "v2"`. A small `net.Server` parses and strips the PROXY header (peer address, requested hostname), tags the socket in a `WeakMap<Socket, { peer, hostname }>`, then hands it to Fastify with `app.server.emit("connection", socket)`. The guard reads the tag from `request.raw.socket`.
- Rules in the guard: on an **untagged** socket (real loopback) the master token, loopback Hosts and `?token=` work as today, and device cookies work too. On a **tagged** socket only the tunnel hostname is an allowed Host, only `https://<hostname>` an allowed Origin, and only a **device cookie** authenticates; the master token and `?token=` are refused.
- `GuardContext` (frozen in Phase 0): `{ session, access: Core["access"], tunnel: TunnelProvenance, hostnames(): ReadonlySet<string> }`. `create-server.ts` and `security/allow-list.ts` are foundation-owned; the allow-list reads the tunnel hostname live (add when online, remove when down).
- Unauthenticated surface on a tagged socket is exactly: `GET /pair`, `POST /api/pair/redeem`, `GET /api/health` (`{ ok: true }` only). `/assets/*` and everything else stay 401.

### Access seam in `Core` (frozen in Phase 0)

`Core.access { verifyDevice(secret) → { deviceId } | undefined, touch(deviceId), listDevices, renameDevice, revokeDevice, signOutAll, mintPairing, redeemPairing }` and `Core.remote { status, enable, disable, recreate }`. The server stays free of business logic: it calls these. The guard sets a Fastify request decoration `deviceId` (`"owner"` for the master token). `registerLive` and `registerTerminalStream` pass it to their connections; a `Map<deviceId, Set<socket>>` closes a device's sockets on revoke. Revoke is also re-checked at every `/live` subscribe and terminal attach.

### Pairing and rate limit (replaces the old redeem text)

- Two kinds of code, both single use, 5 minutes, held in memory (restart burns them), max 5 live: a **link code** of 128 bits in the URL fragment (`https://<hostname>/pair#<code>`), and a **short code** of 8 characters (no lookalikes) typed on `/pair`. Constant-time compare against the live set.
- Failures never burn codes. Limits use the **peer address from the PROXY header**: 5 failures per peer per minute lock that peer for 10 minutes; a global backstop of 100 failures per minute locks short-code redeem only (link codes stay usable). Untagged (loopback) redeem needs no limit beyond the backstop.
- `POST /api/pair/redeem` needs `Content-Type: application/json` (so a cross-site form cannot burn a code) and an Origin of `https://<hostname>`. The pair page calls it with `fetch`, then `location.replace("/")` (same-origin step; `SameSite=Strict` is safe).
- Cookie: one name `tau_device` for devices (no port in it), `Secure` + `HttpOnly` + `SameSite=Strict` when the socket is tagged. The master cookie keeps `tau_<port>`.

### Pair page

One pre-built inline HTML string in `server/src/security/pair-page.ts` (in the style of `session-start-page.ts`), with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-…'; connect-src 'self'` and `cache-control: no-store`. It is the one UI outside the design system, on purpose (the React app needs a session); it uses the app's colour tokens by value and is owned by C. D (web) only builds the Settings side.

### Remote adapter details

- Storage: a custom `OpenTunnelStorage` under `<home>/remote/` (not XDG), so a scratch home never touches the user's tunnel.
- The URL is `https://<hostname>` (route `@`); stable across restarts while the stored identity exists. If the home is lost the tunnel is orphaned (`remove()` needs its token): documented.
- `disable()`: close, then `remove()`. If `remove()` fails (offline) the identity is kept with `pendingRemoval: true` and retried at every start and when the network returns.
- **No automatic re-creation.** `reconnecting` has no timeout that changes the URL; after 10 minutes the status says so and shows a **"Make a new URL"** button (`remote.recreate`), which kills linked devices' URL (their cookies stay valid for the new host only after re-pairing). 
- Relay error text goes through a new `remote/neutral-text.ts` (the existing `neutralText` is Claude-specific).

### Watchdog, starts, last exit

- Heartbeat is a `SharedArrayBuffer` counter incremented by the main thread every second; a `worker_threads` Worker (an extra tsdown entry `dist/watchdog.js`, started with `new Worker(new URL("./watchdog.js", import.meta.url))`) reads it every 5 s and calls `process.exit(1)` after 60 s without change. Started only in `--service` mode (read in `serve.ts` from the flag in `options.ts`).
- `<home>/starts.json` keeps the last 10 start times; 5 starts in 5 minutes → start with `remote` off and say why. `<home>/last-exit.json` holds the previous run's end (`clean`, `watchdog`, `signal`, `unknown` when a run never wrote its end).
- MVP7 already restarts (`render.ts:22` launchd `KeepAlive`, `render.ts:45` systemd `Restart=always`, `RestartSec=5`, Task Scheduler restart on failure). Pin (g) checks the systemd start-limit defaults on a rendered unit; no change otherwise.

### Packaging and CLI

- `@opentunnel/client` and its peer `effect` (exact versions) are dependencies of `packages/core` and `packages/cli`, listed in `neverBundle`; one QR library without DOM dependency (`qrcode`: SVG for the web, text for the terminal) in `packages/web` and `packages/cli`. Biome `noRestrictedImports`: only `core/src/remote/opentunnel-adapter.ts` imports `@opentunnel/client`.
- Phase 0 owns `protocol/src/{rest,entities,core,commands,commands.test}.ts`, the settings schema and its migration (an old `settings.json` loads with `remote` defaulted), `Change` resources `remote` and `devices`, `create-core.ts`, `create-server.ts`, `serve.ts`, `options.ts`, the guard seam, `allow-list.ts`, and the testkit fake and contract tags. Owner E edits only `cli/**`. New routes outside the CLI table: redeem and health go in `COMMAND_EXCLUSIONS` with reasons; `remote`, `devices`, `pair` join `COMMAND_NOUNS`; the destructive list gets `devices revoke` and `remote off` (the exact-list test changes on purpose).
- `tau pair` finds the running server through the existing port store (`cli/src/lifecycle/port-store.ts`) and calls it over loopback with the master token; it enables remote through that server if needed.

### Updated phases

0. Foundation owns everything listed above plus the **security suite extended first**: master token refused on a tagged socket even with `Host: 127.0.0.1:<port>`, a device cookie accepted, forged Host/Origin refused, the unauthenticated surface exact, `/assets/*` 401.
1. A: `core/src/access/**` (devices, pairing, limits). B: `core/src/remote/**`, `core/src/watchdog/**`, `starts.json`, `last-exit.json`. C: `server/src/security/**` (tunnel listener and tags, guard, pair page, redeem and health routes, device-bound sockets). D: `web/src/settings/Remote*` and `components/ui/qr-code.tsx`. E: `cli/**`.

## Phase 0 pins (foundation runs these first; results in this doc)

- (a) The SDK in plain Node 22 here: `create({ store })`, `tunnel.ensure`, `connect({ routes })`, time to first online, hostname shape; **always `remove()` afterwards** (tunnels do not expire).
- (b) Through the public URL from this machine: HTTP GET, a WebSocket upgrade (the `/live` socket), a binary WebSocket (terminal stream), a 5 MB response, 20 parallel requests; what `Host` and `Origin` the server sees.
- (c) The Host/Origin allow-list works with the tunnel hostname and refuses others; `Secure` cookie round trip over https.
- (d) Disable then enable gives a new hostname; the old URL stops answering.
- (e) Restart of the server keeps the same URL; the tunnel is back in under 10 s.
- (f) Offline start (no network): the server starts, status `error`, recovers when the network returns.
- (g) Watchdog: block the event loop in a test server (busy loop) → exit code 1 within the limit; the MVP7 service restarts it (macOS `launchctl kickstart` semantic check with a scratch home and label).
- (h) Bundle size and install size with the SDK and `effect`; the built `dist/bin.js` works from `npm i -g` of a `pnpm pack` tarball.
- (j) **Provenance**: the tagged second listener works with keep-alive, WebSocket upgrade and a binary WebSocket through the real tunnel, and the PROXY v2 header gives the peer address; a visitor sending `Host: 127.0.0.1:<port>` is still tagged (security test).
- (k) The SDK's `new WebSocket(url, { headers })` works on Node 22 (undici) and `effect` bundling or `neverBundle` works from a packed install.
- (i) A real phone browser through the tunnel (**the user does this one**, we do not drive their devices).

## Phases and owners (draft)

0. **Foundation**: pins (a)–(h); dependencies, Biome rule; protocol (`Settings.remote`, `RemoteStatus`, `Device`, routes, `Change` `remote`/`devices`, commands); `Access` and `RemoteAccess` ports with fakes; testkit core fake + contract tags; the dynamic allow-list and the guard split (master token loopback-only, device secret, pair routes) behind the new port, with the **security suite extended first**; stubs for each owner.
1. **Parallel**: **A** access/devices/pairing/rate limit (`core/src/access/**`); **B** remote adapter, status machine, watchdog worker, last-exit (`core/src/remote/**`, `core/src/watchdog/**`); **C** server (guard changes, pair page, redeem, health, device-bound sockets, `security/**`); **D** web (Remote section, link dialog, QR, devices, unauthenticated pair page assets); **E** cli (commands, terminal QR, `tau status`).
2. **Integration**: wiring in `create-core.ts`, `create-server.ts`, `serve.ts`; e2e with the fake adapter (turn on, link a second "device" through the redeem route, revoke, socket cut); then with the **real tunnel** on a scratch home and random port.
3. **Verify for real**: build, run on a scratch home and port, turn remote on, open the public URL in a browser tab with no cookie (401 page), link it with the code, use the app (thread, terminal), revoke, see it cut. The user then links their phone from their own tau.

## Testing

- Core: pairing code single use, expiry with a fake clock, max live codes, rate limit and global lock, device secret hashed at rest, constant-time compare, revoke, last seen; remote status machine over a fake adapter (offline, reconnect, error, disable burns identity); watchdog (fake clock; real stuck-loop test in a child process); last-exit file.
- Server: security suite extended: master token refused on a tunnel Host, device secret accepted, foreign Host/Origin refused, unauthenticated surface is exactly pair page, redeem and health, WebSocket upgrade needs a device cookie, revoke closes sockets, `Secure` cookie flags.
- Web: Remote section states, dialog (countdown, linked state), devices list and revoke, QR renders the link, pair page (no framework) error paths.
- CLI: command table coverage test, `tau pair` prints QR and waits (fake core).
- e2e as above, then the real-tunnel run.

## Risks

- **Remote shell on a public URL.** A stolen device cookie equals the user's account on that machine (agents, terminals, `claude` login). Mitigations: per-device secrets, hashed at rest, revoke, `Secure`, short-lived one-time codes, global rate limit, no master token over the tunnel. Weak spot: no per-visitor rate limit and no second factor.
- **OpenTunnel is young** (0.5.2, one relay we do not control). It sees no plaintext, but it can drop or delay. Pin the version; the adapter is a port.
- **Tunnels do not expire and cannot be deleted without their token**: the store lives in `<home>/remote/`; pins and tests must `remove()`.
- **Watchdog false positives** under heavy CPU work on the main thread (a long sync task): 60 s is generous; log the reason.
- **NixOS / odd hosts**: the user service uses the user manager with linger; verify on the real homelab (the user does this).
- **Mac host sleep** kills the tunnel; a note, not a fix.

## Decisions (agreed with the user)

1. Multi-server threads and runtimes are **out** of this plan (my call, the user asked me to decide): the hub first, runtimes next as one more device kind on the same pairing flow.
2. The pairing code alone is the approval (no "approve on the host" click).
3. A linked device gets **full power** (terminals and agents included), no scopes. The link dialog says so in plain words.
4. First host to test: the user's Mac (this machine), with a scratch home and a random port for agent runs. The user links their own phone from their own tau.
