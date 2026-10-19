# MVP13 plan: nodes (every tau sees every tau in its group)

Status: APPROVED v7 (rounds 1-4 plus the expulsion review applied). Scope agreed with the user. Builds on MVP12 Stage 2 (machines, federation). Facts marked with a file were read; the rest is for the reviewer to attack.

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
- Renames: routes (`/api/machines/**` → `/api/nodes/**`, `/api/m/<id>/**` → `/api/n/<id>/**`), `Core.machines` → `Core.nodes`, types, files and folders (`machines/` → `nodes/`), UI text, CLI (`tau nodes ...`; `tau machines` is an alias in the argument parser only, not a second `COMMANDS` entry), web URLs `/m/...` → `/n/...`. The routes table changes, so `PROTOCOL_VERSION` changes. **Step 0 is a pure rename**: no identity, no alias, no migration. `/m/...` redirects to `/n/...` by prefix with the same id. The compatibility items below belong to **Step 1** (they need `hello` and `nodeId`) and ship with it in 0.2.0; a 0.1.x node linked to a 0.2.0 node shows "update required" (intended).
- **Compatibility with published 0.1.x (done in Step 1, listed here with the rename)**:
  - The device `kind` literal **stays `"machine"` on disk** (`core/src/access/file-device-store.ts:9-13` is a closed union; a 0.1.x tau silently **drops** a `"node"` device, `file-device-store.ts parse`, so a downgrade loses the link; extra optional fields like `nodeId` are tolerated). The reader accepts both; the writer writes `"machine"` for one release. The protocol type says `node`.
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
- **`linkProtocol`** (hash of the **base** frame schemas only: hello, proof, ready, bye, request, response, open, close, credit, data) decides whether two nodes may link. `hello` also carries **`capabilities: string[]`** (`"announce"`, `"relay"` from Step 2): a Step 1 node still links with a Step 2 node, without routing; announces and routing only run between nodes that both list the capability. **`PROTOCOL_VERSION`** (routes, frames, `Change`) only drives the "Update tau" hint and whether the web may open that node's API: a node with another `PROTOCOL_VERSION` stays linked and routed through, shows "update required" and is not opened. Both are bumped with `bump-protocol`.

### Glare and duplicates

- After the handshake both ends know both ids. A link to oneself (equal `nodeId`) closes with 4002. Cases are told apart **by the device secret**: (a) **same device secret** (a reconnect after sleep or crash, while the acceptor still holds the old half-open link for up to 45 s of silence): the **newer link replaces the older**, which closes with 1001; the dialler always retries. (b) **A different device for the same `nodeId`** (a second `tau connect`): the **established link survives** unless it has been silent for more than 15 s (then the new link replaces it, so repairing a dead link by running `tau connect` again works); the new one closes with 4002 (not retried) and its **new node device is revoked**. (c) **Glare** (A and B dial each other at once: two links, different diallers, different secrets): the link whose dialler has the **lower `nodeId`** survives; the other closes with 4002 and **neither device is revoked** (both secrets stay valid for standby).
- `Core.nodes` **dedupes by `nodeId`**. In the glare case the loser's `peers.json` entry stays as **standby** (hidden, not dialled while a live link to that `nodeId` exists, retried every 60 s otherwise; its secret is still valid, so the link recovers from either side); in case (b) the new entry is deleted with its device. `tau disconnect <node>` deletes the standby entry **and** the device.

### Server: one symmetric peer (`server/src/nodes/**`)

- `createLinkPeer({ socket, role, server, peer })` replaces the hub-only `link-session.ts` and the CLI's `link-session`, `link-request`, `link-socket`, `link-sender`. It is both the gateway for requests **to** the remote node and the **responder** for requests **from** it.
- Seam: `server.attachPeer(socket, role, peerInfo)`; the dialler in `cli/src/nodes/link-client.ts` keeps the state machine and backoff (connecting, refused, unreachable, update-required, linked), `peers.json` polling and calls `core.nodes.reportLink(peerId, state)` (**per peer**, replacing the global `HubLink`/`hubState`; `register-link.ts:24` and `register-access-routes.ts:59` change with it). The responder calls the server on loopback at the **bound port** (`RunningServer.port`, not `ServerOptions.port`) with the server's own token; loopback sockets are untagged, so the owner token works.
- **The responder enforces the path filter itself** (`filterProxyPath`), in both directions, plus the header allow-lists: only `routes` templates plus `/api/live` and the terminal stream; denylist as in Step 0; `set-cookie` dropped; `Host`, `Origin`, `Cookie`, `Authorization` never forwarded. A peer cannot reach `/api/access`, `/api/nodes/**` or `/api/n/**` through a link (Step 1 test); forwarding is Step 2's change, made on purpose.
- The guard accepts a node secret only on exactly `GET /api/nodes/link` (or the 0.1.x alias) with `Upgrade: websocket`; the per-peer rate limit stays. The `acceptLinkRefusal` chain/loop rules are removed.
- Revoke or disconnect on either side sends `bye`, closes the link and every proxied stream on **both** sides. A dialler's `disconnect` makes the acceptor revoke the node device (no offline node forever).

### Core and files

- `Core.nodes` lists **peers from both directions** (accepted: node devices; dialled: `peers.json`). The id in the list and in URLs is the peer's **`nodeId`** (same from every viewpoint); a migrated entry uses its old device id until its first `hello`.
- `<home>/hub.json` → `<home>/peers.json`: `{ url, name, nodeId?, publicKey?, secret }[]` (0600, atomic). **Migration**: a 0.1.x `hub.json` is **copied** into a one-entry `peers.json` (only while `peers.json` does not exist); `hub.json` **stays** (decided after the foundation pin F3: a rename would hide it from a downgraded 0.1.x), so a downgrade keeps its link. `tau disconnect` removes both files; an unreadable `hub.json` is moved aside as `hub.json.migrated`. A test starts from a real 0.1.x home.
- Offline cache per known node (`<home>/nodes/<nodeId>/summary.json`, titles and times only), written by the summary writer while the link is healthy.

### Web

- Per-node providers, grouping, offline state, OS icons, `/n/:nodeId/...` as in MVP12; `useNodes()` returns the node's peers.
- **Onboarding gate** lives in `app/App.tsx:32` (`!connected || !defaultModel` → `SetupScreen`), not in `setup/**`. It uses a **server-side flag** `Settings.setupSkipped`, set by "Use my other nodes" (offered when **any known peer** exists, online or not) so a fresh phone browser does not see onboarding again. The gate depends on `setupSkipped` **and** "at least one known peer", not on peer state, so a peer dropping never swaps the app back to setup mid-use; with no peer left, setup shows again. `MainLayout` renders with a local node that has no provider (new thread, model picker, settings paths are checked); the new-thread default target is the first node that has a provider; the local row says "Not set up" with a "Set up" action until one exists.
- Settings → Nodes: "Connect a node" on every node; "Linked to <hub>" and the hub badge are removed; the dialog says plainly **every node in the group gets full power over every other**; accessible names and roles for the table and any "via" hint (never hover-only).

### CLI

`tau connect <link|code> [--name]` works on any node ("already linked" and "yourself" refusals stay). `tau disconnect [node]`, `tau nodes list|rename|disconnect|forget|reset-identity` in Step 1 (`forget` = local only, revokes the device here and closes links, no flood); Step 2 adds `tau nodes remove` (group-wide expel) and `tau access rotate` (`--help` states the difference between `forget` and `remove`). The coverage test and `COMMAND_EXCLUSIONS` are updated on purpose; the exact destructive list (`commands.test.ts:68`, eight today) gains `nodes forget` and `nodes reset-identity` in Step 1 (ten), and `nodes remove` and `access rotate` in Step 2 (twelve); updated deliberately each time.

## Design, Step 2: group routing and expulsion

### Node directory (signed link-state, flooded)

- Each node announces itself: frame `{ type: "announce", payload, sig, ttl }`, payload (domain `tau-announce-v1`) = `origin, publicKey, boot, counter, name, os, tauVersion, protocolVersion, linkProtocol, neighbours: nodeId[]`. A receiver checks `sha256(publicKey) == origin`, then `sig`; **the key travels in the announce**, so a node two hops away can verify it (a known id with another key is refused). `ttl` is outside the signature (relays decrement it). Announce on link-up, on any change of the node's own record or neighbours (coalesced: at most one per 2 s per origin, **trailing edge** so the latest state always goes out), and every 15 s.
- **Sequence** is `(boot, counter)`: `boot = max(lastBoot + 1, Date.now())` persisted **at boot only**, `counter` in memory starting at 0; ordering is lexicographic; a record that is not newer is dropped. The signature stops a relay forging a huge sequence for another origin.
- A node re-floods each new announce to every link except the one it came from (**ttl starts at 16**; the group cap is 16 nodes, diameter at most 15).
- **Topology**: an edge A–B counts **only if both endpoints list each other**. Reachability comes from the **live-edge graph**: a closed local link removes its edge at once and the node announces it; a clean close is detected immediately, a powered-off peer only by the 15 s ping plus 45 s silence; origin expiry (45 s without an announce) is the fallback status. Routes are shortest hop count (ties by lowest `nodeId`), recomputed on every change by a pure, tested `routing.ts`.
- **Cap of 16**: only origins with a mutual edge path to linked members count (a free keypair cannot fill the cap); ghosts (offline origins) are not counted. A 17th live origin is ignored and shown as a warning. Only nodes whose `hello.capabilities` include `"announce"` exchange announces.

### Routed requests and streams (in the link layer, not in HTTP)

- Routing lives in `LinkPeer.request(dest, ...)` and `openStream(dest, ...)`. The node the browser talks to resolves `/api/n/<nodeId>` through the directory and calls it. **Relays never touch loopback and never parse bodies**: they copy frames. (The first node's `/api/n/<id>` handler keeps MVP12's buffered body for its own browser leg; the relay path is chunked frames only.)
- `request` and `open` gain `dest`, `origin`, `originPublicKey`, `trail: nodeId[]`, `ttl` and a signed `payload` (domain `tau-req-v1`) over `dest, origin, method, path, query, contentType, bodyBytes, via, ts, nonce`, plus `originSig`. The destination checks `sha256(originPublicKey) == origin`, the signature, a **timestamp window of ±120 s**, a **bounded nonce cache** (so a replay inside the window is refused) and a `ts` **not earlier than its own boot time** (the cache is lost on restart), that `origin` is not tombstoned, then **applies the path filter** and calls loopback. The origin also filters (early rejection). A clock beyond ±120 s shows "clock skew with <node>" in the UI.
- **What `originSig` gives**: attribution of who started a request and replay protection. It does **not** protect the body or later stream data (a relay is a full-power member and could alter them); this is written in Settings. It is not "a relay cannot forge a request": a relay can only forge what it can sign, and it cannot sign as another origin.
- A relay allocates its **own stream id on the outgoing link** (parity by its role on that link), keeps a table `(inLink, inId) ↔ (outLink, outId)` (cap per link; both entries die together), **rewrites the 4-byte id of every binary frame**, and forwards `ready`, `response`, `credit`, `close` and data both ways. A node refuses a frame whose `trail` contains its own id or whose `ttl` is 0 (no loops while routes converge).
- Flow control stays **per hop** (the credit window of MVP12 applies on every link, initial window per hop); a relay forwards a chunk only when the outgoing link has credit and returns credit upstream only after the chunk was sent downstream, so it buffers at most one window per stream; 60 s without credit closes the stream (1013) on that hop and the close propagates.
- **Audit**: the destination logs the **verified** origin and the `via` label; the `trail` is best effort (relays write it). Labels are sanitised per hop and the chain is capped.
- Failover: a link drop recomputes routes; streams that used it close with 1013 (the web reconnects `/live`); new requests use the new path.

### Expulsion (group-wide, from any node)

- **Expel object**: `{ type: "expel", payload: "tau-expel-v1|<target>|<by>|<time>", byPublicKey, sig }`: no `seq`, idempotent per target. `tau nodes remove <node>` / Settings → Nodes → Remove creates it **on the entry node only** (never proxied through `/n/<id>`; `nodes` stays on the path denylist), refuses self-expel and expelling the entry node, asks for a typed confirmation, and is rate-limited (a few per minute per `by`).
- **Acceptance rule: the union of verified expels.** An expel is valid if `sha256(byPublicKey) == by`, the signature holds, (it arrives over an authenticated link from a member, so `byPublicKey` already proves the signer; there is **no "seen before" rule**, so a node that joins late, or sits behind a cut vertex, accepts an expel for a target it has not met). It is **never rejected for the signer's later status** (A expelling B while B expels C converges on every node to {B, C}). A newly learned expel is **re-flooded**. Abuse is bounded mainly by the **per-link rate limit** (a quota per `by` of 32 live expels helps only against one key, since fresh keys are free); the list is capped at 256, a tombstone for a node that was ever a **linked peer or in the directory is never evicted**, and only tombstones of ids never linked are dropped, oldest first, after 30 days.
- **Storage and sync**: each node persists the **signed expel objects** in `<home>/expelled.json` (0600, atomic). On every link-up both nodes send their **full set** (256 expels at about 300 bytes is about 77 KB, under the 1 MiB frame limit; no diff protocol) **before accepting any announce or route from that neighbour**; a neighbour that sends nothing within **10 s** is marked "unsynced" (no routes through it). Confirmation is explicit: a node that applies an expel floods back a small signed **`expel-ack { target, node }`** (domain `tau-ack-v1`), and the initiator's UI lists who acknowledged ("B has not confirmed"). Announces carry no tombstone data. A node quarantines itself only on a **verified expel against its own id**, never because a neighbour's announce lists it.
- **Flood first, then cut**: on a valid expel a node first **re-floods it to every link except the source** (including toward the target, so the target learns why), and **then** sends `bye`/closes 4003 on its own link to the target, closes every relayed stream through it, deletes its secret and node device and `peers.json` entry, drops `nodes/<id>/` (the cached titles), and removes its edges from the topology at once. The **destination also closes every stream whose `origin` becomes tombstoned** (a shell opened by the expelled node dies).
- A tombstoned id is refused at `hello` (close 4003), in announces, as a route and as a request `origin` (a relay refuses frames whose `trail[0]` or `origin` is tombstoned).
- **Cut vertex and offline cases**: if the expelled node was the only path between two components, the expel reaches only the component of the initiator; the other component keeps trusting it until a link brings the tombstone (the UI shows who has not confirmed). A node that was offline learns it at the first link-up through the full-set exchange; if its only link is to the expelled node, it learns nothing and says so ("no confirmation from the group").
- **Rejoin**: the expelled node sees 4003 and a "this node was removed" state with `tau nodes reset-identity` (deletes `node.json` and `peers.json`, new key and `nodeId`; `expelled.json` is kept on a healthy node so it never lifts tombstones, and is **removed too when this node itself was expelled**); it rejoins with a **new pairing code** from a member. A pairing code redeemed by a tombstoned **device** (known from the redeem request's `nodeId` hint) answers "this node was removed". A reinstalled node that lost `node.json` leaves a **ghost id** offline forever: `nodes remove` works on an offline ghost and ghosts do not count toward the cap.
- **What expulsion is not**: every member has owner power on every node it can route to, including terminals and files, so a hostile member may already have read tokens, `node.json` or created its own access. Removing a node **cuts it off; it does not undo what it did**. Settings says so and offers `tau access rotate`, also shipped in Step 2: it **revokes every node device that is not on a list the user confirms** (hostile devices survive plain `signOutAll`, which keeps node devices) and **swaps the master token live** (`session.rotate`; the token is fixed at start today, `createSession(token, port)`), so no restart is needed; the new token is written to `<home>/token`. The UI lists expulsions with `by` and time. A compromised member can expel others (irreversible for the victim, who must reset identity and be re-paired): accepted under "full power in all directions", mitigated by the typed confirmation and the rate limit.

### Web (Step 2)

`useNodes()` returns the **directory**; a non-neighbour shows like a neighbour with a "via B" label (text, not tooltip-only). The sidebar groups by node as now; the offline cache covers every known node (the summary writer fetches routed summaries at most every 15 s per node). Settings → Nodes shows hops, "via", clock skew, per-node expel confirmation, expulsions with `by`, and a Remove action whose confirmation says the whole group is affected and that it does not undo past actions.

## Security

- Every link gives each side the owner's power on the other; with routing, **every node has owner power on every node it can route to**. Joining one node means trusting the whole group. The dialog says it.
- Identity is a key; announces, `expel` and routed request headers are **signed by their origin**, so a relay cannot forge another node's record, expulsion or request header. Signatures protect against forgery by a relay that does not hold the origin's key; they do **not** change the trust model: a member can read another node's key through a terminal. A member can lie about its **own** neighbours (edges need both ends' agreement) and reads what it relays (relays see plaintext frames; per-hop TLS ends at each node; stated in Settings).
- Mitigations from MVP12 stay: the denylist keeps a peer away from devices, remote and linking; no master token over a tunnel; revoke closes both sides.
- A lost laptop still in the group is a full compromise until it is removed and access rotated.

### Flap guard and session seam

- A cloned home (two machines with the same `peers.json`) shares one device secret, so glare case (a) would let each replace the other forever: after **three replacements within a minute** the node stops redialling and shows "duplicate identity".
- `server/src/security/session.ts` (`createSession(token, port)`) is a foundation seam file in Step 2 (`session.rotate`). The session cookie value is the master token, so a rotate also signs out every local owner browser (stated in the UI); the responder's loopback token reads the live token after a rotate.

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

Phase 0 of each step is **one foundation agent that owns every seam file** (one owner per file, not per folder; `app/App.tsx` and its gate behaviour, `web/src/lib/transport/fake.ts` and the glare/revoke logic in `core/src/access/**` are foundation's, and the parallel owners get them through a note): `cli/src/serve.ts`, `server/src/create-server.ts`, `security/guard.ts`, `security/request-info.ts`, `security/register-access-routes.ts`, `core/src/access/**` (device store fields, `signOutAll` kind rule), `core/src/create-core.ts`, `app/App.tsx`, `protocol/**`, the testkit fake and contract tags, the e2e specs and the web fake transport. Owners fill only their folders; needed changes go in a note for the integrator. Agents run on Sonnet, low effort, in worktrees; the orchestrator commits their work.

- **Step 0** (one agent): the mechanical rename **only** (the compatibility items are Step 1); green check, test, build and the e2e specs terminal, mvp12-remote, mvp12-machines (renamed).
- **Step 1 foundation**: pins p1–p5; protocol (`hello`/`proof`/`ready`/`bye`, parity, `via`, close codes, `linkProtocol`, `Node` with links, commands and coverage test, hash bumps); identity and `node.json`; `peers.json` and migrations; `Settings.setupSkipped`; `Core.nodes` for the real core, `faux-core.ts`, testkit fake with two directions; stubs.
- **Step 1 parallel**: **A** `core/src/nodes/**`; **B** `server/src/nodes/**` (`createLinkPeer`, responder with filter, glare, standby, revoke both sides, `attachPeer`); **C** `web/src/**` (onboarding gate, Nodes page, wording, redirects and lazy key migration); **D** `cli/src/nodes/**` and connect/disconnect/reset-identity (dialler only, removal of the duplicated link code and tests).
- **Step 1 integration**: e2e with two real servers both ways (A sees B and B sees A; threads, terminals, kill, version skew, revoke each side, migration, glare); docs (README, PLAN.md federation text, AGENTS.md wording); release `0.2.0` with the release skill and a skew note for 0.1.x nodes; a link over the tunnel host works and `/api/n/**` is denied on tunnelled sockets for non-device callers; the user's real run (Mac + vibemachine); verify in a browser on two scratch homes.
- **Step 2 foundation**: pins r1–r7; frame schemas (`announce`, `expel`, `expel-ack`, `dest`, `trail`, `ttl`, `originSig`); pure `routing.ts` (BFS, ties, live edges, clamping) and signature helpers with tests; fakes with a three-node group; contract tag; `tau access rotate`; stubs.
- **Step 2 parallel**: **E** `core/src/nodes/directory/**` (announces, sequence, expiry, topology, tombstones, expel, forget, reset-identity); **F** `server/src/nodes/relay/**` (relay table, id rewrite, per-hop credit, trail/ttl, `originSig` check, nonce cache, destination filter, close propagation, stream close on tombstone); **G** `web/src/**` (directory, "via", Remove, skew, confirmation, cache for routed nodes); **H** `cli/**` (`nodes list` with hops, `remove`, `forget`, `access rotate`).
- **Step 2 integration**: three real servers on scratch homes (chain, triangle, failover, lying announce, expel including cut vertex); then the user's real group; verify in a browser with the phone on the middle node.

## Testing

- Server: MVP12 gateway tests in both directions; parity, reuse, `ready`; glare and duplicates; responder filter; revoke and `bye` on both sides; Step 2: relay tables, id rewrite on binary frames, per-hop credit, `trail`/`ttl`, `originSig`, replay window, destination filter, close propagation, failover, close of streams of a tombstoned origin.
- Core: peers from both directions and dedupe; migrations (`hub.json`, device kind, keys); handshake; announce ordering and signatures; BFS ties and mutual edges; cap; tombstone union, mutual expel, full-set exchange, rejoin, offline sync, ghosts.
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

## Phase 0 results (Step 1)

Run by the Step 1 foundation agent on 2026-10-19, before the code. The spikes are throwaway scripts in `/tmp/mvp13-spikes` (not committed): `peer.mjs` is a minimal symmetric peer that implements the **planned** frame rules with `node:crypto` and `ws` only, two loopback nodes with their own http servers (bound ports, own tokens), no OpenTunnel, no SSH, scratch homes under `/tmp`. The permanent versions of what the spikes showed are tests in the repo (named below). All pins pass; findings F1–F6 are the things that surprised us and became decisions.

| Pin | Result | Evidence |
|---|---|---|
| p1 reverse direction | **pass**: GET both ways; 5 MB response in 18 ms; 42 MB body intact (sha256) both ways in 57–75 ms; 20 parallel requests with odd and even ids interleaved; `/live` and a 300 KB binary terminal echo both ways; `ready` arrives before the first data; a 20 MB response nobody reads stops at one 1 MiB window while 10 same-direction requests and the opposite direction keep working; wrong parity, a reused id and a stray `ready` close 1008; a data frame for a stream that was never opened is ignored (no implicit ready) | `p1.mjs` (30 checks) |
| p2 responder at loopback | **pass**: the responder calls loopback at the **bound** port with the server's own token; the guard sees an untagged socket; `Host: 127.0.0.1:0` (the configured port) is refused 403, a foreign `Origin` 403, a peer's node secret 401; the responder's own filter refuses `/api/access`, `/api/nodes/**`, `/api/n/**`, `remote`, `pair`, `update`, `health` and both link paths for every method, and none of them reaches loopback | `p1.mjs` (spike) and `server/src/security/node-link-guard.test.ts` (real server) |
| p3 glare and duplicates | **pass** with the pure arbiter now in `core/src/access/duplicate-links.ts`, driven by real sockets: A and B dial each other at once, both ends keep the link dialled by the lower `nodeId` and close the other 4002 without revoking either device; the standby secret still works and the link recovers when the survivor drops; a second `tau connect` (new device) closes 4002 and its device is revoked; the same secret replaces the older link (1001); a link silent for more than 15 s is replaced | `p3.mts` (12 checks), `duplicate-links.test.ts` |
| p4 migration and 0.1.x | **pass, with F3**: a 0.1.x home (devices.json with `machine`, hub.json) is read by the new code; `hub.json` becomes a one-entry `peers.json` (0600, no `nodeId`) and is kept as `hub.json.migrated`; the new writer writes `"machine"` on disk with `nodeId`/`publicKey` that the **real 0.1.x reader** still accepts, whereas a device written as `"node"` is silently dropped by it; on the new server a 0.1.x dialler on `/api/machines/link` is upgraded (no 401/403) and closed 4001, a wrong secret there is 401, the real path accepts the same secret | `p4/p4.mts` (15 checks, old code from `git show beabe27`), `peers-store.test.ts`, `create-access.test.ts`, `node-link-guard.test.ts` |
| p5 handshake negatives | **pass**: a forged `nodeId`, a reflected `hello` (4002), a wrong key, a replayed proof (another nonce), a reflected proof (ids swapped), a proof of another domain tag, a different key at a pinned id are refused; the right id is accepted | `p1.mjs`, `protocol/src/identity/identity.test.ts` |

Findings and decisions:

- **F1 handshake order**: a `proof` that arrives before the peer's `hello` is a protocol error (1008). Both ends send `hello` immediately when the socket opens (any order between them) and send `proof` only after verifying the peer's `hello`. A client that attaches its `message` listener late loses the first frame: attach it at socket creation.
- **F2 stale replacement revokes**: case (b) with a link silent for more than 15 s replaces it; the foundation also revokes the **replaced** device (`revokeLoser: true`, `stale-replaced`), otherwise "repair with `tau connect` again" leaves an orphan device and breaks "no orphan device". Silence is measured **locally by each end**, so both ends must have seen the silence (a half-open link usually is, because the acceptor holds it for up to 45 s while the dialler's pings fail).
- **F3 downgrade (plan change proposed)**: renaming `hub.json` to `hub.json.migrated` means a 0.1.x tau finds **no hub** after a downgrade until `mv hub.json.migrated hub.json`. The plan says the rename keeps the downgrade link, which is not true by itself. Implemented as the plan says; proposal for the integrator: **copy** instead of rename (leave `hub.json`, treat the existence of `peers.json` as "migrated"), accepting that a later `tau disconnect` leaves a stale `hub.json` whose secret is revoked (harmless: a downgraded tau is refused 401 and shows "refused"). One line in `migrateHubFile` plus its test.
- **F4 destructive list is nine, not ten**: `nodes unlink` and `nodes hub` disappear with the hub concept, so Step 1 has the eight of today minus `nodes unlink` plus `nodes forget` and `nodes reset-identity` = nine (`commands.test.ts` says nine). Step 2 adds `nodes remove` and `access rotate` (eleven), not twelve.
- **F5 pairing kind**: `DeviceKind` and `PairingKind` in the protocol say `node`; `POST /api/pair?kind=machine` is now a 400. Only an old web UI or script would send it, and the web is served by the same server; the disk literal stays `"machine"`.
- **F6 summary directory**: moved to `<home>/nodes/<id>/summary.json`. `migrateSummaryDirectory` renames `machines/` to `nodes/` at start when `nodes/` does not exist (a downgrade just rebuilds its cache). A dialled peer without a `nodeId` yet has the id `u-<12 hex of sha256(url)>` (`peerIdOf`, exported from `@tau/core`); owner A moves `nodes/<oldId>/` to `nodes/<nodeId>/` at the first `hello`.

## Step 1 foundation hand-off

Done when `pnpm check`, `pnpm test` and `pnpm build` pass. Nothing is committed; the orchestrator commits.

### Frozen by the foundation (owners may not change these; ask via a note)

- **Protocol** (`packages/protocol`): the base frames `hello`, `proof`, `ready`, `bye`, `request` (`via`), `response`, `open` (`via`), `close`, `credit`, `ping`, `pong`; `LinkRole`, `firstStreamId`, `isPeerStreamId` (odd ids for the dialler, even for the acceptor); close codes `LINK_CLOSE_*` (1001, 1008, 1013, 4001, 4002, 4003); `NODE_LINK_PATH` and `NODE_LINK_LEGACY_PATH`; `PROTOCOL_VERSION` and the new `LINK_PROTOCOL` (hash of the BASE frames, bumped by the same `bump-protocol`); `NodeHello` with `nodeId`, `publicKey`, `nonce`, `linkProtocol`, `capabilities` and no `threadCount`; `Node` with `identified` and `links: NodeLink[]` (direction `accepted|dialled`, state `connecting|linked|reconnecting|unreachable|update-required|refused|duplicate|standby`); `NodeSelf`; `NodePeerInfo`; `NodeLinkReport`; `Core.nodes` = `self`, `sign`, `list`, `rename`, `disconnect`, `forget`, `resetIdentity`, `reportLink(peerId, state)`, `register(peerId, info, direction)`, `heartbeat`, `markOffline`, `readSummary`, `writeSummary`; `Core.settings.setSetupSkipped` and `Settings.setupSkipped`; routes `getNodeSelf`, `forgetNode`, `resetNodeIdentity`, `setSetupSkipped` (the hub routes `getHubLink` and `disconnectHub` are gone); `DeviceKind`/`PairingKind` say `node`; `Device.nodeId`; `MintedPairing.nodeId`, `RedeemPairingResponse.nodeId`, `pairingLink(url, code, name, nodeId)` (`#code.name&node=<nodeId>`); commands `nodes list|self|rename|summary|disconnect|forget|reset-identity`, `settings set-setup-skipped`; nine destructive commands.
- **Identity** (`@tau/protocol/identity`, a subpath, not in the browser-bound index): `generateNodeKeys`, `nodeIdOf`, `signPayload`, `verifySignature`, `DOMAIN_TAGS`, `signedPayload`, `createHello`, `verifyHello` (reasons `bad-key|bad-nonce|id-mismatch|self|pin-mismatch`, `closeCodeFor`), `createProof`, `verifyProof`. `<home>/node.json` is created by `createNodeIdentityStore` (core); the private key never leaves core: the server asks `core.nodes.self()` and `core.nodes.sign(payload)`.
- **Stores and migrations** (core): `peers.json` (`createFilePeersStore`, `Peer`, `peerIdOf`), `migrateHubFile`, `migrateSummaryDirectory` (both run in `createCore`), the device store (kind `"machine"` on disk, both literals read, optional `nodeId`/`publicKey`), `AccessService.bindNodeIdentity` and `findNodeDevice`, `arbitrateDuplicateLink` (glare/duplicate rules, `core/src/access/duplicate-links.ts`).
- **Seams**: `server.attachPeer(socket, role, peerInfo): PeerHandle` (`server/src/nodes/peer-seam.ts`, stub in `attach-peer.ts`), `LinkClientOptions.attachPeer` and `.peers` (`cli/src/nodes/link-client.ts`, passed by `run.ts`), the guard (alias path, exact paths), `registerLegacyLink`, `app/setup-gate.ts` and the gate in `app/App.tsx`, `SetupScreenProps.onUseOtherNodes`, `lib/node-key-migration.ts`, the testkit fake with two directions (`linkFakeCores`, `nodesControl.attach`), the contract tag `[nodes-symmetric]`.

### Transitional shims (each owner deletes theirs with the code it replaces)

- `protocol/src/node-link-legacy.ts` (the 0.1.x `hello` with `threadCount`): used only by `server/src/nodes/link-session.ts`, `server/src/testing/loopback-node.ts`, `cli/src/nodes/link-*.ts`. Deleted by B and D together.
- `cli/src/nodes/hub-file.ts` is now a one-hub view of `peers.json` for the old one-way dialler and `tau connect` (first entry = "the hub"); D replaces it with the multi-peer client and deletes `hub-file.ts` and its test.
- `web/src/lib/hub-link.ts` derives the old "linked to a hub" row from the peers (first dialled link); C rewrites the Nodes page around `Node.links` and deletes it, `useHubLink`, `useDisconnectHub` and `api.nodes.hubLink/disconnectHub`.
- The old server gateway (`create-gateway`, `link-session`, `link-request`, `link-socket`, `link-stream`) still serves accepted links through `registerNodeLink`; B replaces it with `createLinkPeer` behind `attachPeer`.
- `vocabulary.test.ts` still allows the hub files above; C shrinks `HUB_ALLOWED` as it rewrites each (the `"machine"` literal exemption is gone: no `"machine"` string is left in `web/src`).

### Owner A (`core/src/nodes/**`)

- Fill the `TODO(A)` in `create-nodes.ts`: dedupe two links to one `nodeId` (use `arbitrateDuplicateLink`), hide standby entries (retry every 60 s, not while a live link to that `nodeId` exists), the status of a node with two links, move the summary from the old id to the `nodeId` at the first `hello`, `forget` without `bye` (core's local effect equals `disconnect`; the `bye` difference is the server's).
- Implement `dialPeer` on the real contract target (`core/src/contract.test.ts`: write a `peers.json` entry) and remove `"[nodes-symmetric]"` from `PENDING_TAGS`.
- A peer whose `nodeId` is already held by another device: `register` ignores `duplicate-device` (the arbiter decides before core is told); decide where the revoke happens with B.

### Owner B (`server/src/nodes/**`)

- Replace `attach-peer.ts` with `createLinkPeer({ socket, role, server, peer })`: handshake (`createHello`, `verifyHello` with `pinnedNodeId`, `createProof`, `verifyProof`, close codes from `closeCodeFor`), parity and `ready`, `bye`, per-stream credit as in the p1 spike, the responder at the **bound** port with the server's own token (`RunningServer.port`), `filterProxyPath` on the responder (the denylist is already tested), `via` -> `x-tau-via`, heartbeat and `core.nodes.register(peerId, info, direction)`, glare/duplicate through `arbitrateDuplicateLink` (a map `nodeId -> link facts`), revoke/disconnect sends `bye` and closes every proxied stream on both sides.
- Point `register-link.ts` at `attachPeer(socket, "acceptor", { peerId: request.deviceId, secretKey })` for `NODE_LINK_PATH`; the alias is already handled by `registerLegacyLink` (4001).
- Delete the legacy gateway, `node-link-legacy.ts` use in `link-session`/`loopback-node`, and port the MVP12 gateway tests to both directions.

### Owner C (`web/src/**`)

- The Nodes page around `Node.links` (OS icons, offline state, "Connect a node" on every node, the "every node gets full power over every other" text, accessible names), delete `lib/hub-link.ts` and the hub hooks.
- `SetupScreen`: render "Use my other nodes" from `onUseOtherNodes` (the gate already passes it only when a peer is known); `MainLayout` with a local node that has no provider ("Not set up", "Set up", default target = first node with a provider).
- Keys: `lib/node-key-migration.ts` (the seam documents trigger and rules), `/m/<id>` -> `/n/<nodeId>` redirect through the node list, `nodeKey` marker from `:m:` to `:n:` with the lazy migration.
- Fake transport (`lib/transport/fake.ts`) is the foundation's; ask by note.

### Owner D (`cli/src/nodes/**`, `cli/src/commands/**` for connect and disconnect)

- A multi-peer dialler on `LinkClientOptions.peers` and `.attachPeer`: poll `peers.json`, open one websocket per entry (not for a standby that has a live link), call `attachPeer(socket, "dialler", { peerId: peerIdOf(peer), pinnedNodeId: peer.nodeId, secretKey })`, map `PeerClosed` to `core.nodes.reportLink(peerId, state)` with the backoff of today's client (4001 `update-required`, 4002 and `bye` not retried, 1008 `refused`, 401/403 `refused`), delete the old `link-session`, `link-request`, `link-socket`, `link-sender`, `hub-file` and their tests.
- `tau connect` on any node (the "already linked" and "yourself" refusals use `alreadyLinkedRefusal` and `selfLinkRefusal`; read the acceptor's `nodeId` from the link's `&node=` and from the redeem response and write it, pinned, in `peers.json`), `tau disconnect [node]`, `tau nodes list|rename|disconnect|forget|reset-identity` through the routes (reset-identity must restart the dialler: core already makes a new identity live and clears `peers.json`).

### Notes for the integrator

- Run `bump-protocol` after any change to routes, base frames or `Change` (it rewrites `PROTOCOL_VERSION` and `LINK_PROTOCOL`).
- `hub.json` handling and the downgrade note (F3), the nine destructive commands (F4) and the 400 for `kind=machine` (F5) need your decision before 0.2.0 notes.
- `e2e/tests/mvp12-nodes.spec.ts` mints `kind=node` now; the e2e suite was not run by the foundation (it needs the built CLI, a browser and ports); the integration step runs it with the two-way specs.
- The alias `/api/machines/link` closes 4001 for **every** caller, also a 0.2.0 dialler that used it by mistake.


### Foundation decisions (orchestrator, after review of the hand-off)

- **F3**: `migrateHubFile` now **copies** (leaves `hub.json`, `peers.json` existing means migrated); `tau disconnect` (owner D) must delete both `peers.json` entry and `hub.json`. An unreadable `hub.json` is still moved to `hub.json.migrated`.
- **F4**: the destructive list is nine after Step 1 (`nodes unlink` and `nodes hub` are gone), Step 2 ends at eleven.
- F1, F2, F5, F6 accepted as implemented.

## Phase 0 results (Step 2)

Run by the Step 2 foundation agent on 2026-10-19, against real code in the worktree (no spikes needed: the pure modules are the permanent versions). r2, r3, r5 and the replay/skew half of r7 are **unit tests that pass today**; r1, r4, r6 and the clock-offset half of r7 need real sockets and the owners' code, so they are written skeletons with the exact acceptance numbers.

| Pin | Result | Evidence |
|---|---|---|
| r1 three real servers A–B–C | **skeleton** (`test.fixme`, not run): A sees C within 20 s; GET, terminal stream, 42 MB body with the right ids on every hop; kill B cleanly: C offline on A within 5 s; SIGSTOP: within 60 s; with a link A–C, C stays reachable after B dies | `e2e/tests/mvp13-step2-pins.spec.ts` |
| r2 triangle, no looping frame | **pass (pure part)**: BFS on a triangle gives hops 1/1; a 16-node chain routes 15 hops with `ttl` 16 and nothing ignored; `loopsBack` refuses a frame whose `trail` holds our id or whose `ttl` is 0; `forwardTtl` dies at 0; `clampTtl` forces garbage into [0, 16]. The "no frame circulates on a real triangle" half is a server skeleton | `protocol/src/routing.test.ts`, `server/src/testing/step2-pins.test.ts` (todo) |
| r3 lying announce | **pass**: forged origin (key does not hash to the id), wrong signature, wrong key for a known id (`key-mismatch`), a counter forged after signing (`bad-signature`), a counter beyond 2^53 (`bad-payload`), 16 neighbours (`too-many-neighbours`; the bound is 15), an announce listing its own origin, a payload of another domain tag: every one is refused; `(boot, counter)` ordering drops a record that is not strictly newer; `nextBoot` moves forward when the clock goes back. One-sided neighbours: no edge in `routing.test.ts`. An announce about the receiver and the stale-origin case are the directory's (owner E) | `protocol/src/identity/directory-signatures.test.ts`, `routing.test.ts` |
| r4 credit across two hops | **skeleton** (`it.todo`, server): a 20 MB response nobody reads through B buffers at most one 1 MiB window; 20 other requests unaffected; 60 s without credit closes 1013 on that hop and propagates; `ready` forwarded; the id of every binary frame rewritten per hop | `server/src/testing/step2-pins.test.ts` |
| r5 cap of 16 | **pass**: 17 live mutually connected origins in a chain: 15 routes, the 17th ignored; 50 fake keys that list the group but are not listed back never enter the table; 5 expired origins (ghosts) are not counted | `routing.test.ts` ("cap of 16") |
| r6 expel | **skeleton** (e2e `fixme` + server `it.todo`); the signed objects are tested now: `verifyExpel` accepts by the carried key with no "seen before" rule, refuses bad signature, wrong `by`, self-expel and an ack/announce payload replayed as an expel; `verifyAck` binds the confirming node. The fake group runs the whole behaviour (flood, confirmations, "not confirmed", reconnect, quarantine, reset-identity) as the executable spec: `[nodes-group]` cases pass on the fake | `directory-signatures.test.ts`, `testkit/src/contract/nodes-group.ts`, `mvp13-step2-pins.spec.ts` |
| r7 clock skew and replay | **pass (header half)**: ts at exactly ±120 s accepted, 121 s and 130 s refused with `skewMs` reported (the UI's "clock skew"); a replay inside the window refused; a forged header cannot burn a nonce (nonce stored only after the signature verified); a ts before the destination's boot refused; swapped path/body size, another `dest`, a wrong key, a tombstoned origin and a missing field refused. The "UI shows clock skew with <node>" half is a skeleton (needs a clock offset env var on a real server) | `directory-signatures.test.ts`, `mvp13-step2-pins.spec.ts` |

Findings and decisions:

- **S2-F1 linkProtocol stays put**: the routed fields live in `RoutedRequestFrameSchema` / `RoutedOpenFrameSchema` (used in `LinkFrameSchema`), while `BASE_FRAME_SCHEMAS` keeps the Step 1 `request` and `open`. `LINK_PROTOCOL` is unchanged (a Step 1 node still links and ignores the extra fields); only `PROTOCOL_VERSION` was bumped. The new frames `announce`, `expel`, `expel-ack`, `expel-sync` are outside the base set for the same reason. Do not move them into `BASE_FRAME_SCHEMAS`.
- **S2-F2 a frame for the full expel set**: the plan says "send their full set" without a frame. Added `expel-sync { expels }` (at most 256). `expel-ack` is **not** ttl'd: a node re-floods an ack, an expel or a set entry only when it is **fresh** (newly learned), so a flood always terminates; `announce` is the only frame with `ttl`.
- **S2-F3 cap counts self**: `GROUP_NODE_CAP` 16 is self plus 15 others (`computeRoutes` admits 15 routes). The announce bound is therefore 15 neighbours.
- **S2-F4 signed text is percent-encoded**: names, paths, queries, content types and `via` enter a signed payload through `encodeURIComponent` (the separator `|` can never appear), numbers as decimals. `signedPayload` still throws on a raw `|`.
- **S2-F5 nonce cache**: bounded at 4096 entries, entries live 240 s (2 × the window), the oldest is dropped beyond the cap; a member flooding valid requests can evict old nonces inside the window. Accepted under "full power in all directions"; the `ts >= boot` rule covers a restart.
- **S2-F6 capabilities shim**: `STEP2_CAPABILITIES` (`announce`, `relay`) exists, `NODE_CAPABILITIES` stays `[]` until the integrator flips it (see the hand-off), so no released behaviour changes before E and F are merged.
- **S2-F7 new error codes**: `cannot_remove_self` 409, `confirmation_mismatch` 422, `rate_limited` 429, `node_removed` 403, `no_route` 502, `clock_skew` 409.
- **S2-F8 `access rotate` keeps by device id, any kind**: hostile *devices* (not only nodes) can exist, so `keep` lists device ids of any kind; the caller's own device and nothing else is implicit. There is no preview route: the CLI/UI lists `GET /api/access/devices` and sends `keep`.
- **S2-F9 owner of link dispatch**: F cannot add frame handling for `announce`/`expel` without touching `link-peer.ts`; see the F ownership note below (F owns all of `server/src/nodes/**`, new code in `relay/`).

## Step 2 foundation hand-off

Done when `pnpm check`, `pnpm test` and `pnpm build` pass (all three passed unpiped at the last commit, see the foundation report). The foundation committed in its worktree (no push, no tag).

### Frozen by the foundation (owners may not change these; ask via a note)

- **Protocol** (`packages/protocol`): `node-link-routing.ts` (constants `GROUP_NODE_CAP`, `ROUTE_TTL_START`, `ANNOUNCE_*`, `REQUEST_WINDOW_MS`, `EXPEL_*`, `NONCE_CACHE_CAP`, capability names; `RoutedFieldsSchema`, frames `AnnounceFrame`, `ExpelFrame`, `ExpelAckFrame`, `ExpelSyncFrame`); `RoutedRequestFrameSchema`/`RoutedOpenFrameSchema` in `LinkFrameSchema`; `node-group.ts` (`DirectoryNode`, `Expulsion`, `RemoveNodeBody`, `AnnounceOutcome`, `ExpelOutcome`, `AckOutcome`, the **`NodeGroup` interface**); `NodeSelf.removed`; error codes above; routes `getNodeDirectory` (`GET /api/nodes/directory`), `listExpulsions` (`GET /api/nodes/expulsions`), `removeNode` (`POST /api/nodes/:id/remove`, body `{ confirm }`), `rotateAccess` (`POST /api/access/rotate`, body `{ keep? }`, answers `{ revoked, token }`); commands `nodes directory`, `nodes expulsions`, `nodes remove`, `access rotate` (noun `access`; eleven destructive commands); `Core.nodes.directory()`, `.expulsions()`, `.group`, `Core.access.rotate({ keep, callerDeviceId })`; new `PROTOCOL_VERSION` (bumped), `LINK_PROTOCOL` unchanged.
- **Pure modules** (tested, import from `@tau/protocol` or `@tau/protocol/identity`): `routing.ts` (`computeRoutes`, `mutualEdges`, `clampTtl`, `forwardTtl`, `loopsBack`, `DirectoryRecord`, `RouteTable`; browser-safe), `identity/announce.ts` (`createAnnounce`, `verifyAnnounce`), `identity/expel.ts` (`createExpel`, `verifyExpel`, `createAck`, `verifyAck`), `identity/request-header.ts` (`signRequestHeader`, `verifyRequestHeader`), `identity/sequence.ts`, `identity/time-window.ts`, `identity/nonce-cache.ts`, `identity/fields.ts`.
- **Seams**: `core/src/nodes/directory/ports.ts` (`DirectoryDeps`, `Directory`) and the wiring in `core/src/create-core.ts` (the directory is composed beside `createNodes`; `nodes.self()` adds `removed`; `resetIdentity` calls `directory.reset()`); `home.expelledFile` (`<home>/expelled.json`); `server/src/nodes/relay/ports.ts` (`RelayDeps`, `Relay`) wired in `server/src/create-server.ts` (`start()` on listen, `floodExpel` from `removeNode`); `Session.currentToken()` and `Session.rotate(token)`; `ServerOptions.onTokenRotated`; `PeerServer.token` is a live getter; `cli/src/serve.ts` writes `<home>/token` on rotate; route handlers for the four new routes (`register-node-routes.ts`, `register-access-routes.ts`); testkit `createFakeGroup` (A–B–C), `FakeCore.nodesControl.reach/joinGroup`, `ContractTarget.group`, contract tags `[nodes-group]` and `[access-rotate]`; `web/src/lib/transport/fake.ts` handlers.

### Transitional shims (each owner deletes theirs with the code it replaces)

- `NODE_CAPABILITIES` in `protocol/src/nodes.ts` is `[]`. **Integrator** flips it to `STEP2_CAPABILITIES` after merging E and F (both fake and real `self()` read it).
- `core/src/nodes/directory/create-directory.ts`: `directory()` returns every peer as a direct neighbour (hops 1); `createInertGroup()` rejects `Not implemented: NodeGroup.*` (except `expelSet` → `[]`, `route` → undefined, `isTombstoned` → false). **E** replaces it.
- `server/src/nodes/relay/create-relay.ts` is a no-op (`start`, `floodExpel`). **F** replaces it. Until then `POST /api/nodes/:id/remove` answers 500 `internal` on the real core (`createExpel` is a stub).
- The real core runs `[nodes-group]` as `it.todo` (`PENDING_TAGS` in `core/src/contract.test.ts`); **the integrator** removes the tag when E and F are merged and gives the real target a `group()` (three cores wired through `attachPeer` on loopback).
- `e2e/tests/mvp13-step2-pins.spec.ts` (`test.fixme`) and `server/src/testing/step2-pins.test.ts` (`it.todo`): the integrator / F fill and unskip them.
- The web still reads `listNodes` (Step 1); **G** switches `useNodes()` to `getNodeDirectory`.

### Owner E (`core/src/nodes/directory/**`)

- Files: everything under `core/src/nodes/directory/` (stubs: `create-directory.ts`; add `expel-store.ts`, `announce-table.ts`, etc. there).
- Fill `createDirectory(deps)` so it returns the `Directory` contract and every `NodeGroup` method: sequence `(boot, counter)` persisted at boot (file beside `expelled.json`), `localAnnounce` (neighbours = synced `linkUp` peers), `acceptAnnounce` (use `verifyAnnounce` with the known key; refuse an announce about self, a tombstoned origin, a non-`announce` neighbour, an unsynced neighbour, a stale sequence; cap via `computeRoutes().ignored`; `forwardTtl`), expiry after `ANNOUNCE_EXPIRY_MS` (ghost, not counted), topology via `computeRoutes`, tombstones from `<home>/expelled.json` (signed objects, 0600, atomic, cap 256, never evict a linked/directory node), `createExpel` (typed confirmation = name or id → `confirmation_mismatch`; self or the entry node → `cannot_remove_self`; `EXPEL_CREATE_PER_MINUTE` → `rate_limited`), `acceptExpel`/`acceptExpelSet` (union of verified expels, re-flood only when fresh, `ack` for a fresh one, `selfExpelled` quarantine only on a verified expel against our id), `acceptAck`, `expulsions()` with confirmations and pending, `directory()` with hops/via/skew/ghost/unsynced, `forget` of a tombstoned peer through `deps.nodes.forget`, `reset()` (keeps `expelled.json`, removes it when this node itself was expelled), `removal()`.
- Tests: add `directory/*.test.ts`; then enable the real-core `[nodes-group]` cases with the integrator (`PENDING_TAGS`); they are the acceptance (`testkit/src/contract/nodes-group.ts`, executable on the fake today). Pins r3 (announce half), r5 (cap in the directory), r6 (core side).
- Do not edit `ports.ts`, `create-core.ts`, `create-nodes.ts` (need a hook? note for the integrator).

### Owner F (`server/src/nodes/**`, new code in `server/src/nodes/relay/**`)

- Ownership note: F owns **all** of `server/src/nodes/**` because routed frames need dispatch in `link-peer.ts`/`link-mux.ts`; Step 1's owner B no longer exists, so no file is shared. Seams F must not edit: `server/src/create-server.ts`, `security/**`.
- Fill `createRelay(deps)` (`ports.ts` is frozen): relay table `(inLink, inId) ↔ (outLink, outId)` with a cap per link and own stream ids by role, rewrite of the 4-byte id of every binary frame, `ready`/`response`/`credit`/`close`/data both ways, per-hop credit (forward only with outgoing credit, return credit after the downstream send, 60 s no credit → 1013 and propagate), `trail`/`ttl` (`loopsBack`, `forwardTtl`), `originSig` check at the destination with `verifyRequestHeader` (nonce cache from `createNonceCache`, `bootAt` = server start, `isTombstoned` = `core.nodes.group.isTombstoned`) then the responder's path filter and loopback; the origin filters early; `RoutedFields` on `LinkPeer.request(dest, …)`/`openStream`; `/api/n/<id>` resolves through `core.nodes.group.route`; announce, `expel`, `expel-ack`, `expel-sync` dispatch to `core.nodes.group.*` and flooding to every link but the source (only for peers whose `hello.capabilities` list `announce`/`relay`); sync before announce (10 s → `markUnsynced`); the 15 s announce timer and coalescing (one per 2 s, trailing edge) driven by `group.onTopology`; `floodExpel(frame)` (flood first, then `bye` + 4003, close relayed streams, `core.nodes.forget`); `group.onTombstone` closes every stream whose `origin` is tombstoned; refuse `hello` of a tombstoned id (4003); flap guard (three replacements in a minute → "duplicate identity"); `recordSkew` from verified headers; `clock_skew`/`node_removed`/`no_route` AppErrors on refusals.
- Tests: `relay/*.test.ts` plus the `server/src/testing/step2-pins.test.ts` todos (r2 server half, r4, r6 server half, r7); real loopback pairs as in `link-two-nodes.test.ts`.

### Owner G (`web/src/**` except two seam files)

- Files: all of `web/src/**` except `app/App.tsx` and `lib/transport/fake.ts` (foundation's).
- Switch `useNodes()` and the sidebar to `getNodeDirectory` (add `api.nodes.directory/expulsions/remove` in `lib/api.ts`, `useRemoveNode`, queries; `Change{resource:"nodes"}` already invalidates); a routed node shows like a neighbour with a **text** "via <name>"; hops and clock skew (`skewMs` beyond 120 s → "clock skew with <node>") in Settings → Nodes; **Remove** with a typed-confirmation dialog saying the whole group is affected and that it does not undo past actions, plus the "B has not confirmed" list from `expulsions()` with `by` and time; a node with `NodeSelf.removed` shows "this node was removed, reset its identity"; offline cache for routed nodes (the summary writer is server-side); accessible names (no hover-only text); the rotate hint ("run `tau access rotate`") in the Remove confirmation. Put new UI only in `components/ui` first.
- Tests: component tests on the fake (`createFakeGroup` is available from `@tau/testkit` for three-node grouping; `?fake=ready&nodes` in the dev fake). Need changes to `App.tsx` or `fake.ts`? Note for the integrator.

### Owner H (`cli/**` except `cli/src/serve.ts`)

- `tau nodes list` shows hops/`via` (use `nodes directory`; keep the table small), `tau nodes remove <node> --confirm <name|id>` (typed confirmation; the table-driven runner already knows the command; check `nodes remove` and `access rotate` in the coverage test and `--help` text: `forget` vs `remove`), `tau nodes forget`, `tau access rotate [--keep <id,id>]`: list `GET /api/access/devices`, show what would be revoked, ask (destructive), call `rotateAccess`, print the new token once, re-read `<home>/token` for later calls; note `keep` is an array flag (the generic runner may need a comma-split; if so it is H's change under `cli/src/commands/**`).
- Tests: `commands.test.ts` already counts eleven destructive commands; add CLI tests for the four flows with the fake core.

### Notes for the integrator

- Order: merge E, F, G, H as each finishes; run `check` and `test` after each. `bump-protocol` after any route/frame change (routes were bumped by the foundation; `LINK_PROTOCOL` must stay equal to the Step 1 value — if it changes, a base frame was touched by mistake).
- Flip `NODE_CAPABILITIES` to `STEP2_CAPABILITIES`; remove `[nodes-group]` from `PENDING_TAGS`; give the real contract target `group()`; unskip the e2e pins and fill r1/r6/r7 with three scratch homes; add `TAU_FAKE_CLOCK_OFFSET_MS` (r7) in the server's clock, owned by F.
- `directory.reset()` is wired for `resetIdentity` but **not** for remote `disable/recreate` (`nodes.reset()`): decide with E whether those clear tombstones (they should not).
- The e2e suite was not run by the foundation (needs the built CLI, a browser and ports).
- Foundation worktree: `/Users/pablopunk/.tau/worktrees/tau/mvp13-step-2-foundation`, branch of the same name; nothing pushed.
