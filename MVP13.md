# MVP13 plan: nodes (every tau sees every tau in its group)

Status: DRAFT v5 (one clean text; rounds 1 and 2 plus the expulsion review applied; round 3 pending). Scope agreed with the user. Builds on MVP12 Stage 2 (machines, federation). Facts marked with a file were read; the rest is for the reviewer to attack.

## Goal

> I link taus once. From any node, in any browser or on my phone, I see the threads of **every** node in the group and can work on any of them, even with no direct link (A–B and B–C means A sees C). I can remove any node from the whole group from wherever I am. There is no "hub" and no "machine": every tau is a **node**.

## What exists (MVP12) and what is wrong with it

- A link is one WebSocket dialled by the machine (`cli/src/machines/link-client.ts`, 203 lines) to `GET /api/machines/link` on the hub (`server/src/machines/register-link.ts`). Requests flow **hub → machine only**: `link-session.ts` allocates all stream ids from 1 and sends `request` and `open`; the machine answers by calling **its own server on loopback** with the owner token (`cli/src/machines/link-request.ts`). The machine's echo of `open` is the ready-ack (`link-session.ts:157,178`; a data frame also marks a stream ready).
- The path filter runs **only on the hub** (`register-proxy.ts`); the machine trusts the hub's path.
- `protocol/src/machine-rules.ts`: a linked tau refuses links, a tau with machines refuses `tau connect`, one hub per tau (`hub.json`).
- Seen on 2026-10-19: a phone paired to vibemachine (linked to the Mac) shows first-run onboarding and no threads, because vibemachine knows the Mac only as a name and a URL.

## Decisions (agreed with the user)

1. **Full power in all directions**, no scopes.
2. **Onboarding** is per node, once, only when the node cannot run threads yet (no provider). A node with a known peer may skip it; its own setup stays available.
3. The word is **node** (UI, CLI, URLs, code).
4. **Propagation**: every node learns every other node and reaches it through intermediate nodes.
5. **Expel from anywhere**: from any node the user removes any node from the whole group in one action.

## Scope

Three steps. Step 0 is a commit, not a release. Steps 0 and 1 ship together as **0.2.0**; Step 2 follows after Step 1 passes check, test, build and e2e.

- **Step 0: the rename** (machine → node), one mechanical commit with green check, test, build and e2e specs.
- **Step 1: symmetric links** (both ways, one peer implementation, signed identity, onboarding skip).
- **Step 2: group routing and expulsion** (node directory, routed requests and streams, signed expel).

Out (later plans): per-link permissions or scopes; a second factor; threads that move between nodes; direct LAN links; groups above 16 nodes; wiping an expelled node; end-to-end encryption between origin and destination.

## Step 0: the rename

- A mechanical commit **before** any protocol change. About 270 files mention `machine` today.
- Renames: routes (`/api/machines/**` → `/api/nodes/**`, `/api/m/<id>/**` → `/api/n/<id>/**`), `Core.machines` → `Core.nodes`, types, files and folders (`machines/` → `nodes/`), UI text, CLI (`tau nodes ...`; `tau machines` is an alias in the argument parser only, not a second `COMMANDS` entry), web URLs `/m/...` → `/n/...`. The routes table changes, so `PROTOCOL_VERSION` changes: a 0.1.x node linked to a 0.2.0 node shows "update required" (this is intended; there is no 0.1.x ↔ 0.2.0 compatibility beyond that message).
- **Compatibility with published 0.1.x**:
  - The device `kind` literal **stays `"machine"` on disk** (`core/src/access/file-device-store.ts:9-13` is a closed union; a 0.1.x tau reading `"node"` fails to load, which breaks downgrade). The reader accepts both; the writer writes `"machine"` for one release. The protocol type says `node`.
  - The old path `/api/machines/link` stays as an **alias**: `isMachineLink` (`security/request-info.ts:59-60`) and the guard accept both paths; the alias accepts the upgrade and closes with 4001, so a 0.1.x dialler shows "Update tau" (0.1.x treats 401/403 as "refused", `link-client.ts REFUSED_STATUSES`, so the guard must not answer 401 there).
  - `/m/<id>` URLs resolve through the node list (the old id is the device id seen from this viewpoint) and redirect to `/n/<nodeId>`.
  - localStorage keys (`machineKey`, `scopeTarget`, `summary-cache`, `preferences`) migrate **lazily, at the node's first `hello`** (a node without a `nodeId` yet keeps its old keys); a test covers drafts, seen-baselines and the summary cache.
- `DENIED_FIRST_SEGMENTS` (`server/src/machines/path-filter.ts:11`) lists `machines`, `update`: the rename makes it `nodes`, `n`, `update`, `access`, `remote`, `pair`, `health`.

## Design, Step 1: symmetric links

### Identity (frozen in Step 1, so ids never change later)

- Each node has an **Ed25519 key pair** in `<home>/node.json` (0600), `node:crypto`, no new dependency. `nodeId = base32(sha256(publicKey))`: self-certifying; a different key cannot claim an id; a known id with a different key is refused, never overwritten. A node without `node.json` creates it at start.
- **Signed things use a canonical string**, never re-serialised JSON: frames that carry a signature look like `{ type, payload: "<string>", sig, ... }` where `payload` is signed verbatim and starts with a **domain tag** (`tau-proof-v1`, `tau-announce-v1`, `tau-expel-v1`, `tau-req-v1`), so a signature of one kind can never be replayed as another. Mutable hop fields (`ttl`) are outside the payload.
- **Handshake**: after the upgrade each end sends `hello { nodeId, publicKey, nonce (16 random bytes), name, os, tauVersion, protocolVersion, linkProtocol }`, then `proof { payload: "tau-proof-v1|<peer nonce>|<own nodeId>|<peer nodeId>", sig }`. The receiver checks `sha256(publicKey) == nodeId`, the signature, its own nonce and ids (a reflected `hello` hits the self-link refusal). A failure closes with 1008. A dialler with a **pinned** `nodeId` in `peers.json` refuses a different one. First contact is trust-on-first-use, narrowed by putting the acceptor's `nodeId` in the pairing link and in the redeem response so the dialler checks it at the first `hello`; a transparent man-in-the-middle on a link without TLS can still relay both proofs: accepted and written in Settings (a tunnel URL is https).
- The acceptor stores `nodeId` and the public key on the **node device** at the first `hello` (`FileDeviceStore` gets optional fields); the dialler stores them in its `peers.json` entry. Fields are optional for a migrated entry until its first `hello`. `hello` has no `threadCount` (thread counts come from the summary writer).

### Frames and ids

- **Stream ids**: the dialler allocates **odd** ids, the acceptor **even** ids. A peer-initiated `request` or `open` with the wrong parity or an id in use closes the link (1008).
- `open` always means "new stream". A new explicit **`ready { id }`** frame acknowledges a stream; a data frame no longer implies ready.
- `bye { reason }` is sent before an intended close (disconnect, remove, expel); the other side marks the link intentionally closed and does not retry.
- `request.hubDevice` becomes `via` (label of whoever acted, header `x-tau-via` on the loopback call; sanitised and capped as in `device-labels.ts`).
- Close codes: 4001 update required, 4002 duplicate (not retried), 4003 removed from the group (not retried; the expelled node's UI says "this node was removed, reset its identity", see Step 2).
- **`linkProtocol`** (hash of the frame schemas, announce schema and relay rules) decides whether two nodes may link and route. **`PROTOCOL_VERSION`** (routes, frames, `Change`) only drives the "Update tau" hint and whether the web may open that node's API: a node with another `PROTOCOL_VERSION` stays linked and routed through, shows "update required" and is not opened. Both are bumped with `bump-protocol`.

### Glare and duplicates

- After the handshake both ends know both ids. A link to oneself (equal `nodeId`) closes with 4002. If a link for the pair already exists or both dialled at once: when the two links have **different diallers**, the link whose dialler has the **lower `nodeId`** survives; when both have the **same dialler** (a second `tau connect`), the **older established link** survives. The loser closes with 4002 and is not retried, and its **node device is revoked** on the acceptor (no orphan secret).
- `Core.nodes` **dedupes by `nodeId`**. The loser's `peers.json` entry stays as **standby** (hidden, not dialled while a live link to that `nodeId` exists, retried every 60 s otherwise), so the link recovers from either side; `tau disconnect` deletes it.

### Server: one symmetric peer (`server/src/nodes/**`)

- `createLinkPeer({ socket, role, server, peer })` replaces the hub-only `link-session.ts` and the CLI's `link-session`, `link-request`, `link-socket`, `link-sender`. It is both the gateway for requests **to** the remote node and the **responder** for requests **from** it.
- Seam: `server.attachPeer(socket, role, peerInfo)`; the dialler in `cli/src/nodes/link-client.ts` keeps the state machine and backoff (connecting, refused, unreachable, update-required, linked), `peers.json` polling and calls `core.nodes.reportLink(peerId, state)` (**per peer**, replacing the global `HubLink`/`hubState`; `register-link.ts:24` and `register-access-routes.ts:59` change with it). The responder calls the server on loopback at the **bound port** (`RunningServer.port`, not `ServerOptions.port`) with the server's own token; loopback sockets are untagged, so the owner token works.
- **The responder enforces the path filter itself** (`filterProxyPath`), in both directions, plus the header allow-lists: only `routes` templates plus `/api/live` and the terminal stream; denylist as in Step 0; `set-cookie` dropped; `Host`, `Origin`, `Cookie`, `Authorization` never forwarded. A peer cannot reach `/api/access`, `/api/nodes/**` or `/api/n/**` through a link (Step 1 test); forwarding is Step 2's change, made on purpose.
- The guard accepts a node secret only on exactly `GET /api/nodes/link` (or the 0.1.x alias) with `Upgrade: websocket`; the per-peer rate limit stays. The `acceptLinkRefusal` chain/loop rules are removed.
- Revoke or disconnect on either side sends `bye`, closes the link and every proxied stream on **both** sides. A dialler's `disconnect` makes the acceptor revoke the node device (no offline node forever).

### Core and files

- `Core.nodes` lists **peers from both directions** (accepted: node devices; dialled: `peers.json`). The id in the list and in URLs is the peer's **`nodeId`** (same from every viewpoint); a migrated entry uses its old device id until its first `hello`.
- `<home>/hub.json` → `<home>/peers.json`: `{ url, name, nodeId?, publicKey?, secret }[]` (0600, atomic). **Migration**: a 0.1.x `hub.json` is read once and written as a one-entry `peers.json`; `hub.json` **stays for one release** (renamed `hub.json.migrated`), so a downgrade keeps its link. A test starts from a real 0.1.x home.
- Offline cache per known node (`<home>/nodes/<nodeId>/summary.json`, titles and times only), written by the summary writer while the link is healthy.

### Web

- Per-node providers, grouping, offline state, OS icons, `/n/:nodeId/...` as in MVP12; `useNodes()` returns the node's peers.
- **Onboarding gate** lives in `app/App.tsx:32` (`!connected || !defaultModel` → `SetupScreen`), not in `setup/**`. It uses a **server-side flag** `Settings.setupSkipped`, set by "Use my other nodes" (offered when **any known peer** exists, online or not) so a fresh phone browser does not see onboarding again. The gate depends on `setupSkipped` **and** "at least one known peer", not on peer state, so a peer dropping never swaps the app back to setup mid-use; with no peer left, setup shows again. `MainLayout` renders with a local node that has no provider (new thread, model picker, settings paths are checked); the new-thread default target is the first node that has a provider; the local row says "Not set up" with a "Set up" action until one exists.
- Settings → Nodes: "Connect a node" on every node; "Linked to <hub>" and the hub badge are removed; the dialog says plainly **every node in the group gets full power over every other**; accessible names and roles for the table and any "via" hint (never hover-only).

### CLI

`tau connect <link|code> [--name]` works on any node ("already linked" and "yourself" refusals stay). `tau disconnect [node]`, `tau nodes list|rename|disconnect|remove|forget|reset-identity` (`forget` = local only, revokes the device here and closes links, no flood; `remove` = group-wide; `--help` states the difference). The coverage test and `COMMAND_EXCLUSIONS` are updated on purpose; the exact destructive list (`commands.test.ts:68`, eight today) gains `nodes remove`, `nodes forget` (ten) and is updated deliberately.

## Design, Step 2: group routing and expulsion

### Node directory (signed link-state, flooded)

- Each node announces itself: frame `{ type: "announce", payload, sig, ttl }`, payload (domain `tau-announce-v1`) = `origin, publicKey, boot, counter, name, os, tauVersion, protocolVersion, linkProtocol, neighbours: nodeId[], tombstoneDigest`. A receiver checks `sha256(publicKey) == origin`, then `sig`; **the key travels in the announce**, so a node two hops away can verify it (a known id with another key is refused). `ttl` is outside the signature (relays decrement it). Announce on link-up, on any change of the node's own record or neighbours (rate-limited to one per 2 s per origin), and every 15 s.
- **Sequence** is `(boot, counter)`: `boot = max(lastBoot + 1, Date.now())` persisted **at boot only**, `counter` in memory starting at 0; ordering is lexicographic; a record that is not newer is dropped. The signature stops a relay forging a huge sequence for another origin.
- A node re-floods each new announce to every link except the one it came from (**ttl starts at 16**; the group cap is 16 nodes, diameter at most 15).
- **Topology**: an edge A–B counts **only if both endpoints list each other**. Reachability comes from the **live-edge graph**: a closed local link removes its edge at once and the node announces it; a clean close is detected immediately, a powered-off peer only by the 15 s ping plus 45 s silence; origin expiry (45 s without an announce) is the fallback status. Routes are shortest hop count (ties by lowest `nodeId`), recomputed on every change by a pure, tested `routing.ts`.
- **Cap of 16**: only origins with a mutual edge path to linked members count (a free keypair cannot fill the cap); ghosts (offline origins) are not counted. A 17th live origin is ignored and shown as a warning. Only nodes with the same **`linkProtocol`** exchange announces.

### Routed requests and streams (in the link layer, not in HTTP)

- Routing lives in `LinkPeer.request(dest, ...)` and `openStream(dest, ...)`. The node the browser talks to resolves `/api/n/<nodeId>` through the directory and calls it. **Relays never touch loopback and never parse bodies**: they copy frames. (The first node's `/api/n/<id>` handler keeps MVP12's buffered body for its own browser leg; the relay path is chunked frames only.)
- `request` and `open` gain `dest`, `origin`, `originPublicKey`, `trail: nodeId[]`, `ttl` and a signed `payload` (domain `tau-req-v1`) over `dest, origin, id, method, path, query, contentType, bodyBytes, via, ts, nonce`, plus `originSig`. The destination checks `sha256(originPublicKey) == origin`, the signature, a **timestamp window of ±120 s**, a **bounded nonce cache** (so a replay inside the window is refused), that `origin` is not tombstoned, then **applies the path filter** and calls loopback. The origin also filters (early rejection). A clock beyond ±120 s shows "clock skew with <node>" in the UI.
- **What `originSig` gives**: attribution of who started a request and replay protection. It does **not** protect the body or later stream data (a relay is a full-power member and could alter them); this is written in Settings. It is not "a relay cannot forge a request": a relay can only forge what it can sign, and it cannot sign as another origin.
- A relay allocates its **own stream id on the outgoing link** (parity by its role on that link), keeps a table `(inLink, inId) ↔ (outLink, outId)` (cap per link; both entries die together), **rewrites the 4-byte id of every binary frame**, and forwards `ready`, `response`, `credit`, `close` and data both ways. A node refuses a frame whose `trail` contains its own id or whose `ttl` is 0 (no loops while routes converge).
- Flow control stays **per hop** (the credit window of MVP12 applies on every link, initial window per hop); a relay forwards a chunk only when the outgoing link has credit and returns credit upstream only after the chunk was sent downstream, so it buffers at most one window per stream; 60 s without credit closes the stream (1013) on that hop and the close propagates.
- **Audit**: the destination logs the **verified** origin and the `via` label; the `trail` is best effort (relays write it). Labels are sanitised per hop and the chain is capped.
- Failover: a link drop recomputes routes; streams that used it close with 1013 (the web reconnects `/live`); new requests use the new path.

### Expulsion (group-wide, from any node)

- **Expel object**: `{ type: "expel", payload: "tau-expel-v1|<target>|<by>|<time>", byPublicKey, sig }`: no `seq`, idempotent per target. `tau nodes remove <node>` / Settings → Nodes → Remove creates it **on the entry node only** (never proxied through `/n/<id>`; `nodes` stays on the path denylist), refuses self-expel and expelling the entry node, asks for a typed confirmation, and is rate-limited (a few per minute per `by`).
- **Acceptance rule: the union of verified expels.** An expel is valid if `sha256(byPublicKey) == by`, the signature holds, and `by` is a node this node has seen in a signed announce or `hello`; it is **never rejected for the signer's later status** (so A expelling B while B expels C converges on every node to {B, C}). Only an expel whose **target was seen** in a signed announce or `hello` is accepted, and the list is capped at 256 (oldest dropped after 30 days of being synced). Tombstones never expire otherwise.
- **Storage and sync**: each node persists the **signed expel objects** in `<home>/expelled.json` (0600, atomic). On every link-up the two nodes exchange the **full set** (digest first, then a diff) **before accepting any announce or route from that neighbour**; announces carry only a `tombstoneDigest`, which also gives the initiator a per-node confirmation in the UI ("B has not confirmed"). A node quarantines itself only on a **verified expel against its own id**, never because a neighbour's announce lists it.
- **Flood first, then cut**: on a valid expel a node first **re-floods it to every link except the source** (including toward the target, so the target learns why), and **then** sends `bye`/closes 4003 on its own link to the target, closes every relayed stream through it, deletes its secret and node device and `peers.json` entry, drops `nodes/<id>/` (the cached titles), and removes its edges from the topology at once. The **destination also closes every stream whose `origin` becomes tombstoned** (a shell opened by the expelled node dies).
- A tombstoned id is refused at `hello` (close 4003), in announces, as a route and as a request `origin` (a relay refuses frames whose `trail[0]` or `origin` is tombstoned).
- **Cut vertex and offline cases**: if the expelled node was the only path between two components, the expel reaches only the component of the initiator; the other component keeps trusting it until a link brings the tombstone (the UI shows who has not confirmed). A node that was offline learns it at the first link-up through the diff exchange; if its only link is to the expelled node, it learns nothing and says so ("no confirmation from the group").
- **Rejoin**: the expelled node sees 4003 and a "this node was removed" state with `tau nodes reset-identity` (deletes `node.json`, `peers.json` and `expelled.json`, new key and `nodeId`); it rejoins with a **new pairing code** from a member. A pairing code redeemed by a tombstoned **device** (known from the redeem request's `nodeId` hint) answers "this node was removed". A reinstalled node that lost `node.json` leaves a **ghost id** offline forever: `nodes remove` works on an offline ghost and ghosts do not count toward the cap.
- **What expulsion is not**: every member has owner power on every node it can route to, including terminals and files, so a hostile member may already have read tokens, `node.json` or created its own access. Removing a node **cuts it off; it does not undo what it did**. Settings says so and offers `tau access rotate` (`signOutAll` plus a new master token, delivered through the existing token file), also shipped in Step 2. The UI lists expulsions with `by` and time. A compromised member can expel others (irreversible for the victim, who must reset identity and be re-paired): accepted under "full power in all directions", mitigated by the typed confirmation and the rate limit.

### Web (Step 2)

`useNodes()` returns the **directory**; a non-neighbour shows like a neighbour with a "via B" label (text, not tooltip-only). The sidebar groups by node as now; the offline cache covers every known node (the summary writer fetches routed summaries at most every 15 s per node). Settings → Nodes shows hops, "via", clock skew, per-node expel confirmation, expulsions with `by`, and a Remove action whose confirmation says the whole group is affected and that it does not undo past actions.

## Security

- Every link gives each side the owner's power on the other; with routing, **every node has owner power on every node it can route to**. Joining one node means trusting the whole group. The dialog says it.
- Identity is a key; announces, `expel` and routed request headers are **signed by their origin**, so a relay cannot forge another node's record, expulsion or request header. Signatures protect against forgery by a relay that does not hold the origin's key; they do **not** change the trust model: a member can read another node's key through a terminal. A member can lie about its **own** neighbours (edges need both ends' agreement) and reads what it relays (relays see plaintext frames; per-hop TLS ends at each node; stated in Settings).
- Mitigations from MVP12 stay: the denylist keeps a peer away from devices, remote and linking; no master token over a tunnel; revoke closes both sides.
- A lost laptop still in the group is a full compromise until it is removed and access rotated.

## Phase 0 pins (foundation runs these first; results go in this doc)

Step 1:
- (p1) The reverse direction over an existing link: GET, 5 MB response, 42 MB body, 20 parallel requests, `/live` and a binary terminal stream, odd and even ids interleaved; a stalled stream one way does not stall the other; wrong-parity and reused ids are refused; `ready` semantics.
- (p2) The responder calls loopback at the bound port with the server's token; the guard sees an untagged socket; the responder's own filter refuses `/api/access`, `/api/nodes/**`, `/api/n/**`.
- (p3) Glare: A and B dial each other at once; a second `tau connect` from the same dialler; exactly one link survives, no orphan device, standby recovers when the survivor drops.
- (p4) `hub.json` → `peers.json`, the device-store reader with a real 0.1.x home; a 0.1.x dialler against the new server gets 4001 on the alias path (guard accepts both paths, no 401) and shows "Update tau"; downgrade keeps its link.
- (p5) Handshake: a wrong key, a forged `nodeId`, a replayed or reflected proof, a different key at a pinned id are refused.

Step 2:
- (r1) Three real built servers A–B–C on scratch homes: A sees C within 20 s; a GET, a terminal stream and a 42 MB body from A reach C through B with the right ids on every hop; kill B cleanly: C offline on A within 5 s; power-loss simulation (SIGSTOP): within 60 s; add a link A–C: C stays reachable after B dies.
- (r2) Triangle: no frame circulates; a forged looping frame dies by `trail` and `ttl`; announces converge; a 16-node chain routes (ttl 16).
- (r3) A lying announce (forged origin, huge counter, wrong signature, wrong key for an id, one-sided neighbours, an announce about the receiver, oversized lists) is ignored or bounded; the origin's real announces still win.
- (r4) Credit across two hops: a stalled browser at the far end, 20 other requests unaffected; memory per relayed stream within the window; `ready` forwarded.
- (r5) Cap of 16 counts only mutually connected live origins; a node with free fake keys cannot fill it.
- (r6) Expel: chain and triangle; `expel C` on A reaches B and C's other links within 5 s; C cannot relink, route or originate requests; its open shell stream closes on the destination; refused with its old id (4003); an offline node learns the tombstone on reconnect **before** accepting routes; cut vertex (A–C–B) and offline-with-only-C cases show "not confirmed"; mutual expel converges; a forged `expel` (bad signature, wrong `by`, signer outside the group) and a replayed one are ignored; a neighbour's announce cannot quarantine a node; `reset-identity` and rejoin with a new key work; a stale announce for an expelled node is dropped.
- (r7) Clock skew: a request with a ts beyond ±120 s is refused and shown; a replay inside the window is refused.

## Phases and owners

Phase 0 of each step is **one foundation agent that owns every seam file**: `cli/src/serve.ts`, `server/src/create-server.ts`, `security/guard.ts`, `security/request-info.ts`, `security/register-access-routes.ts`, `core/src/access/**` (device store fields, `signOutAll` kind rule), `core/src/create-core.ts`, `app/App.tsx`, `protocol/**`, the testkit fake and contract tags, the e2e specs and the web fake transport. Owners fill only their folders; needed changes go in a note for the integrator. Agents run on Sonnet, low effort, in worktrees; the orchestrator commits their work.

- **Step 0** (one agent): the mechanical rename and the compatibility items; green check, test, build and the e2e specs terminal, mvp12-remote, mvp12-machines (renamed).
- **Step 1 foundation**: pins p1–p5; protocol (`hello`/`proof`/`ready`/`bye`, parity, `via`, close codes, `linkProtocol`, `Node` with links, commands and coverage test, hash bumps); identity and `node.json`; `peers.json` and migrations; `Settings.setupSkipped`; `Core.nodes` for the real core, `faux-core.ts`, testkit fake with two directions; stubs.
- **Step 1 parallel**: **A** `core/src/nodes/**`; **B** `server/src/nodes/**` (`createLinkPeer`, responder with filter, glare, standby, revoke both sides, `attachPeer`); **C** `web/src/**` (onboarding gate, Nodes page, wording, redirects and lazy key migration); **D** `cli/src/nodes/**` and connect/disconnect/reset-identity (dialler only, removal of the duplicated link code and tests).
- **Step 1 integration**: e2e with two real servers both ways (A sees B and B sees A; threads, terminals, kill, version skew, revoke each side, migration, glare); docs (README, PLAN.md federation text, AGENTS.md wording); release `0.2.0` with the release skill and a skew note for 0.1.x nodes; a link over the tunnel host works and `/api/n/**` is denied on tunnelled sockets for non-device callers; the user's real run (Mac + vibemachine); verify in a browser on two scratch homes.
- **Step 2 foundation**: pins r1–r7; frame schemas (`announce`, `expel`, `dest`, `trail`, `ttl`, `originSig`); pure `routing.ts` (BFS, ties, live edges, clamping) and signature helpers with tests; fakes with a three-node group; contract tag; `tau access rotate`; stubs.
- **Step 2 parallel**: **E** `core/src/nodes/directory/**` (announces, sequence, expiry, topology, tombstones, expel, forget, reset-identity); **F** `server/src/nodes/relay/**` (relay table, id rewrite, per-hop credit, trail/ttl, `originSig` check, nonce cache, destination filter, close propagation, stream close on tombstone); **G** `web/src/**` (directory, "via", Remove, skew, confirmation, cache for routed nodes); **H** `cli/**` (`nodes list` with hops, `remove`, `forget`, `access rotate`).
- **Step 2 integration**: three real servers on scratch homes (chain, triangle, failover, lying announce, expel including cut vertex); then the user's real group; verify in a browser with the phone on the middle node.

## Testing

- Server: MVP12 gateway tests in both directions; parity, reuse, `ready`; glare and duplicates; responder filter; revoke and `bye` on both sides; Step 2: relay tables, id rewrite on binary frames, per-hop credit, `trail`/`ttl`, `originSig`, replay window, destination filter, close propagation, failover, close of streams of a tombstoned origin.
- Core: peers from both directions and dedupe; migrations (`hub.json`, device kind, keys); handshake; announce ordering and signatures; BFS ties and mutual edges; cap; tombstone union, mutual expel, diff exchange, rejoin, offline sync, ghosts.
- Web: onboarding gate with the server flag and peer-drop behaviour; "Not set up"; no `machine` or `hub` strings; `/m/` redirect and lazy key migration; three-node grouping; "via" as text.
- CLI: connect on a node with peers; disconnect by name; `remove`, `forget`, `reset-identity`, `access rotate`.
- e2e as in the phases.

## Risks

- **Every node controls every node**; expulsion cuts a node off but does not wipe it or undo what it did.
- **Relays read plaintext** of what they forward and `originSig` gives no payload integrity.
- **The rename is wide** (about 270 files): its own green commit first.
- **Link refactor** (about 700 lines move from `cli` to `server`): the MVP12 tests run in both directions are the net.
- **Routing bugs** (loops, black holes, stale routes) are the weakest part of Step 2: pure routing module, mutual edges, `trail` and `ttl`, signed headers, a real triangle test.
- **0.1.x nodes** show "Update tau" through the alias; files migrate and `hub.json` stays for one release.
- **Version skew**: `linkProtocol` mismatch splits routing; `PROTOCOL_VERSION` mismatch only blocks opening that node's API.
- **A skipped setup hides a half-configured node**: its row says "Not set up".
- **Clock skew** on phones or small boards breaks routed requests: shown in the UI.
