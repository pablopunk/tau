# MVP13 plan: nodes (every tau sees every tau in its group)

Status: DRAFT v4 (one clean text; round 1 applied; round 2 pending). Scope agreed with the user. Builds on MVP12 Stage 2 (machines, federation). Facts marked with a file were read; the rest is for the reviewer to attack.

## Goal

> I link taus once. From any node, in any browser or on my phone, I see the threads of **every** node in the group and can work on any of them, even with no direct link (A–B and B–C means A sees C). I can remove any node from the whole group from wherever I am. There is no "hub" and no "machine": every tau is a **node**.

## What exists (MVP12) and what is wrong with it

- A link is one WebSocket dialled by the machine (`cli/src/machines/link-client.ts`, 203 lines) to `GET /api/machines/link` on the hub (`server/src/machines/register-link.ts`). Requests flow **hub → machine only**: the hub's `link-session.ts` allocates all stream ids from 1 and sends `request` and `open`; the machine answers by calling **its own server on loopback** with the owner token (`cli/src/machines/link-request.ts`). The machine's reply to `open` (an echo) is the ready-ack (`link-session.ts:157,178`).
- The path filter runs **only on the hub** (`register-proxy.ts`); the machine trusts the hub's path.
- `protocol/src/machine-rules.ts`: a linked tau refuses links, a tau with machines refuses `tau connect`, one hub per tau (`hub.json`).
- Seen on 2026-10-19: a phone paired to vibemachine (linked to the Mac) shows first-run onboarding and no threads, because vibemachine knows the Mac only as a name and a URL.

## Decisions (agreed with the user)

1. **Full power in all directions**, no scopes.
2. **Onboarding** is per node, once, only when the node cannot run threads yet (no provider). A node with a reachable peer may skip it; its own setup stays available.
3. The word is **node** (UI, CLI, URLs, code).
4. **Propagation**: every node learns every other node and reaches it through intermediate nodes.
5. **Expel from anywhere**: from any node the user removes any node from the whole group in one action.

## Scope

Three steps, each releasable. A later step starts after the earlier one passes check, test, build and e2e.

- **Step 0: the rename** (machine → node), one mechanical commit, no behaviour change.
- **Step 1: symmetric links** (both ways, one peer implementation, signed identity, onboarding skip).
- **Step 2: group routing and expulsion** (node directory, routed requests and streams, signed expel).

Out (later plans): per-link permissions or scopes; a second factor; threads that move between nodes; direct LAN links; groups above 16 nodes; wiping an expelled node.

## Step 0: the rename

- Its own commit, with `check`, `test`, `build` and the e2e specs green, **before** any protocol change. 269 files mention `machine` today.
- Renames: protocol routes (`/api/machines/**` → `/api/nodes/**`, `/api/m/<id>/**` → `/api/n/<id>/**`), `Core.machines` → `Core.nodes`, types, files and folders (`machines/` → `nodes/`), UI text, CLI (`tau nodes ...`; `tau machines` is an alias in the argument parser only, not a second `COMMANDS` entry), web URLs `/m/...` → `/n/...`, `PROTOCOL_VERSION` bump.
- **Compatibility with published 0.1.x**:
  - The device `kind` literal **stays `"machine"` on disk** (`core/src/access/file-device-store.ts:9-13` is a closed union; a 0.1.x tau reading `"node"` fails to load, which would break downgrade). The reader accepts both; the writer writes `"machine"` for one release. The protocol type says `node`.
  - The old path `/api/machines/link` stays as an **alias** that accepts the upgrade and closes with 4001 (update required), so a 0.1.x dialler shows "Update tau" and not "unreachable".
  - `/m/<id>` URLs resolve through the node list (the old id is the device id seen from this viewpoint) and redirect to `/n/<nodeId>`.
  - localStorage keys (`machineKey`, `scopeTarget`, `summary-cache`, `preferences`) are migrated once from the device id to the `nodeId` through the same lookup; a test covers drafts, seen-baselines and the summary cache.
- `DENIED_FIRST_SEGMENTS` (`server/src/machines/path-filter.ts:11`) lists `machines`, `update`; the rename updates it to `nodes` and keeps `update` denied. `machine-text`, grep test: no `machine` or `hub` strings in UI text (Step 1 finishes this).

## Design, Step 1: symmetric links

### Identity (frozen in Step 1, so ids never change later)

- Each node has an **Ed25519 key pair** in `<home>/node.json` (0600). `nodeId = base32(sha256(publicKey))`: self-certifying, no PKI, cannot be claimed by another key. A node without `node.json` creates it at start.
- **Handshake**: after the upgrade each end sends `hello { nodeId, publicKey, nonce, name, os, tauVersion, protocolVersion, linkProtocol }`, then `proof { sig }` = signature over the **peer's nonce** and both node ids. A peer whose `nodeId` does not match its key, or whose proof fails, is closed (1008). `hello` carries no `threadCount` (thread counts come from the summary writer).
- The acceptor stores `nodeId` and the public key on the **node device** at the first `hello` (`FileDeviceStore` gets optional fields). The dialler stores them in its `peers.json` entry. A 0.1.x `hub.json` entry has none: the fields are optional until the first `hello`.

### Frames and ids

- **Stream ids**: the dialler allocates **odd** ids, the acceptor **even** ids. A peer-initiated `request` or `open` whose id has the wrong parity or is already in use is refused and closes the link (1008).
- The overloaded `open` echo goes: a new explicit **`ready { id }`** frame acknowledges a stream; `open` always means "new stream".
- `bye { reason }` is sent before an intended close (disconnect, remove, expel); on `bye` the other side marks the link intentionally closed and does not retry.
- `request.hubDevice` becomes `via` (label of whoever acted; header `x-tau-via` on the loopback call; sanitised and capped as in `device-labels.ts`).
- Close codes: 4001 update required, 4002 duplicate (not retried), 4003 expelled (not retried).
- **`linkProtocol`** (hash of the frame schemas, the announce schema and the relay rules) decides whether two nodes may link and route. **`PROTOCOL_VERSION`** (routes, frames, `Change`) only drives the "Update tau" hint and whether the web may open that node's API: a node with a different `PROTOCOL_VERSION` stays reachable and routed through, but shows "update required" and is not opened. Both bumped with `bump-protocol`.

### Glare and duplicates

- After the handshake both ends know both node ids. If a link for that pair already exists (or both nodes dialled at once), the link whose **dialler has the lower `nodeId`** survives; the other closes with 4002 and is not retried. A link to oneself (equal `nodeId`) closes with 4002.
- The superseded or duplicate **node device is revoked** on the acceptor, so no orphan secret stays.

### Server: one symmetric peer (`server/src/nodes/**`)

- `createLinkPeer({ socket, role, server, peer })` replaces the hub-only `link-session.ts` and the CLI's `link-session`, `link-request`, `link-socket`, `link-sender`. It is both the gateway for requests **to** the remote node and the **responder** for requests **from** it.
- Seam: `server.attachPeer(socket, role, peerInfo)`; the dialler in `cli/src/nodes/link-client.ts` keeps the state machine and backoff (connecting, refused, unreachable, update-required, linked), `peers.json` polling, and calls `core.nodes.reportLink(peerId, state)` (**per peer**, replacing the global `HubLink`/`hubState`; `register-link.ts:24` and `register-access-routes.ts:59` change with it). The responder calls the server on loopback at the **bound port** (`RunningServer.port`, not `ServerOptions.port`) with the server's own token; loopback sockets are untagged, so the owner token works (as the CLI link client does today).
- **The responder enforces the path filter itself** (`filterProxyPath`), in both directions, plus the header allow-lists: only `routes` templates plus `/api/live` and the terminal stream; denylist `access`, `remote`, `nodes`, `n`, `update`, `pair`, `health`; `set-cookie` dropped; `Host`, `Origin`, `Cookie`, `Authorization` never forwarded. A peer therefore cannot reach `/api/access`, `/api/nodes/**` or `/api/n/**` through a link (Step 1 test); forwarding is Step 2's change, made on purpose.
- The guard accepts a node secret only on exactly `GET /api/nodes/link` with `Upgrade: websocket` (unchanged rule, renamed); the per-peer rate limit stays. The `acceptLinkRefusal` chain/loop rules are removed.
- Revoke or disconnect on either side sends `bye`, closes the link and every proxied stream on **both** sides.

### Core and files

- `Core.nodes` lists **peers from both directions** (accepted: node devices; dialled: `peers.json`). The id in the list and in URLs is the peer's **`nodeId`** (same from every viewpoint); until the first `hello` of a migrated entry the old device id is used (and mapped).
- `<home>/hub.json` → `<home>/peers.json`: `{ url, name, nodeId?, publicKey?, secret }[]` (0600, atomic). **Migration**: a 0.1.x `hub.json` is read once, written as a one-entry `peers.json`, then deleted; a test starts from a real 0.1.x home.
- Offline cache per known node (`<home>/nodes/<nodeId>/summary.json`, titles and times only), written by the summary writer while the link is healthy.
- `disconnect` on the dialler sends `bye(disconnect)`; the acceptor then revokes the node device (no offline node forever).

### Web

- Per-node providers, grouping, offline state, OS icons, `/n/:nodeId/...` as in MVP12; `useNodes()` returns the node's peers.
- **Onboarding gate** lives in `app/App.tsx:32` (`!connected || !defaultModel` → `SetupScreen`), not in `setup/**`. The gate uses a **server-side flag** `Settings.setupSkipped` (persisted on the node, so a fresh phone browser does not see onboarding again), set by "Use my other nodes", which is offered only when an online peer exists. `MainLayout` must render with a local node that has no provider (new thread, model picker, settings paths are checked; the node's own row says "Not set up" with a "Set up" action until a provider exists).
- Settings → Nodes: "Connect a node" on every node; "Linked to <hub>" and the hub badge are removed; the dialog says plainly **every node in the group gets full power over every other**; accessible names and roles for the table and any "via" hint (never hover-only).

### CLI

`tau connect <link|code> [--name]` works on any node ("already linked" and "yourself" refusals stay). `tau disconnect [node]`, `tau nodes list|rename|disconnect|remove|forget`. Coverage test and `COMMAND_EXCLUSIONS` updated on purpose; the exact destructive list (`commands.test.ts:68`, eight today) gains `nodes forget` and `nodes remove` and is updated deliberately.

## Design, Step 2: group routing and expulsion

### Node directory (signed link-state, flooded)

- Each node announces itself with `announce { origin, boot, seq, name, os, tauVersion, protocolVersion, linkProtocol, neighbours: nodeId[], expelled: nodeId[], ttl, sig }` on link-up, on any change of its own record or neighbours, and every 15 s. Signed by the origin key; a node ignores an unsigned, wrongly signed, or unknown-key announce (the key comes from the `hello` of the first link, or from an announce signed by a key whose `nodeId = hash(key)`, which proves ownership). No `threadCount` (the summary writer carries it); announces on change are rate-limited to one per 2 s per origin.
- **Sequence** is `(boot, counter)` with `counter = max(last + 1, Date.now())`, persisted; a node ignores a record that is not newer, and a **signature** stops a relay from forging a huge `seq` for another origin.
- A node re-floods each new announce to every link except the one it came from (ttl − 1, **ttl starts at 16**; the group cap is 16 nodes, diameter at most 15).
- **Topology**: an edge A–B counts **only if both endpoints list each other** (so a liar cannot claim adjacency to attract routes). Reachability comes from the **live-edge graph**: a closed local link removes its edge at once, and the node announces it; origin expiry (45 s without an announce) is only the fallback status, so failover does not wait for it. Routes are shortest hop count (ties by lowest `nodeId`), recomputed on every change by a pure, tested `routing.ts`.
- Cap: 16 nodes; the 17th announcement is ignored and shown as a warning. Only nodes with the same **`linkProtocol`** exchange announces.

### Routed requests and streams (in the link layer, not in HTTP)

- Routing lives in `LinkPeer.request(dest, ...)` and `openStream(dest, ...)`. The node the browser talks to resolves `/api/n/<nodeId>` through the directory and calls it. **Relays never touch loopback and never parse bodies**: they copy frames. (The existing hub proxy buffers whole bodies in `GatewayRequest.body`; the first node's `/api/n/<id>` handler keeps that for its own browser leg, and the relay path is chunked frames only, so a 42 MB body is never buffered per hop.)
- `request` and `open` gain `dest`, `origin`, `trail: nodeId[]`, `ttl`, `ts`, `nonce` and **`originSig`**, a signature by the origin over the header fields (`dest`, `id`, `method`, `path`, `query`, `ts`, `nonce`). A relay allocates its **own stream id on the outgoing link** (parity by its role on that link), keeps a table `(inLink, inId) ↔ (outLink, outId)`, **rewrites the 4-byte id of every binary frame**, and copies data and control frames both ways. The table has a cap per link and both entries die together.
- A node refuses a frame whose `trail` contains its own id or whose `ttl` is 0 (no loops while routes converge), and the **destination** verifies `originSig` against the origin's known key, rejects a stale `ts`/replayed `nonce`, rejects a tombstoned origin, **applies the path filter**, then calls loopback. The origin also filters (early rejection).
- Flow control stays **per hop** (MVP12's credit window per link); a relay forwards a chunk only when the outgoing link has credit and returns credit upstream only after the chunk was sent downstream, so it buffers at most one window per stream; 60 s without credit closes the stream (1013) on that hop and the close propagates.
- **Audit**: the destination logs the authenticated origin (verified by `originSig`) and the `via` device label; the relay chain in `trail` is best effort (relays write it). Labels are sanitised per hop and the chain is capped.
- Failover: a link drop recomputes routes; streams that used it close with 1013 (the web reconnects `/live`); new requests use the new path.

### Expulsion (group-wide, from any node)

- `tau nodes remove <node>` / Settings → Nodes → Remove creates **`expel { target, by, seq, sig }`**, signed by `by`, flooded like an announce. On receipt (valid signature by a known, non-tombstoned member, newer `seq`) a node: sends `bye(expelled)`/closes with 4003 on its own link to the target and every relayed stream through it, deletes the target's secret and node device, and adds the target (`nodeId` and public key) to the persisted **tombstone list** `<home>/expelled.json` (0600, atomic) with `by` and time.
- A tombstoned id is refused on link (`hello`), in announces, as a route and as a request `origin` (a relay refuses frames whose `trail[0]` or `origin` is tombstoned). The list also travels in every announce (`expelled`), so a node that was **offline** learns it when it reconnects, **before it accepts any route**; a node that was partitioned merges tombstones on first contact (union; tombstones never expire).
- The expelled node can rejoin only with a **new pairing code** from a member, with a **new key and `nodeId`** (so the old tombstone does not match). Any member may expel any member (full power is the agreed model); a compromised node can therefore expel others: they can be re-linked, and Settings lists expulsions with `by`. An expelled node that never reconnects keeps what is on its own disk: it is cut off, not wiped (the UI says so). `tau nodes forget <id>` stays as a local-only action (closes this node's links to it, revokes its device here, no flood).
- Partitions: if the expelled node was the only path between two others, they lose that path (and see each other offline); they are not told it was an expulsion beyond the tombstone list.

### Web (Step 2)

`useNodes()` returns the **directory**; a non-neighbour shows like a neighbour with a "via B" label (text, not tooltip-only). The sidebar groups by node as now; the offline cache covers every known node (the summary writer fetches routed summaries at most every 15 s per node). Settings → Nodes shows hops, "via", expulsions with `by`, and a Remove action with a confirm that says the whole group is affected.

## Security

- Every link gives each side the owner's power on the other; with routing, **every node has owner power on every node it can route to**. Joining one node means trusting the whole group. The dialog says it.
- Identity is a key; announces, `expel` and routed request headers are **signed by their origin**, so a relay cannot forge another node's record, expulsion or request. A member can still lie about its **own** neighbours (edges need both ends' agreement) and read what it relays (relays see plaintext frames: stated in Settings; per-hop TLS ends at each node, there is no end-to-end encryption between origin and destination in this plan).
- Mitigations from MVP12 stay: the denylist keeps a peer away from devices, remote and linking; no master token over a tunnel; revoke closes both sides.
- A lost laptop that is still in the group is a full compromise until someone expels it (the user's point of "kick out from wherever").

## Phase 0 pins (foundation runs these first; results in this doc)

Step 1:
- (p1) The reverse direction over an existing link: GET, 5 MB response, 42 MB body, 20 parallel requests, `/live` and a binary terminal stream, odd and even ids interleaved; a stalled stream one way does not stall the other; wrong-parity and reused ids are refused.
- (p2) The responder on the acceptor calls loopback at the bound port with the server's token; the guard sees an untagged socket; the responder's own path filter refuses `/api/access`, `/api/nodes/**`, `/api/n/**`.
- (p3) Glare: A and B dial each other at once, and a second `tau connect` from the same node: exactly one link survives, no orphan device, no retry loop.
- (p4) `hub.json` → `peers.json` and the device-store reader with a real 0.1.x home; a 0.1.x dialler against the new server gets 4001 on the alias path and shows "Update tau".
- (p5) Handshake: a wrong key, a forged `nodeId`, a replayed proof are refused.

Step 2:
- (r1) Three real built servers A–B–C on scratch homes: A sees C within 20 s; a GET, a terminal stream and a 42 MB body from A reach C through B with the right ids on every hop; kill B: C goes offline on A within 5 s (live-edge) and not later than 45 s (fallback); add a link A–C: C stays reachable after B dies.
- (r2) Triangle A–B–C–A: no frame circulates; a forged looping frame dies by `trail` and `ttl`; announces converge; a 16-node chain still routes (ttl 16).
- (r3) A lying announce (forged origin, huge `seq`, wrong signature, one-sided neighbours, an announce about the receiver, oversized lists) is ignored or bounded; the origin's real announces still win.
- (r4) Credit across two hops: a stalled browser at the far end, 20 other requests unaffected; memory per relayed stream within the window.
- (r5) Group cap of 16 and the warning.
- (r6) Expel in a chain and in a triangle: `expel C` issued on A reaches B and C's other links within 5 s; C cannot relink, route or originate requests; refused with its old id; an offline node learns the tombstone on reconnect before accepting routes; a forged `expel` and a replayed older `seq` are ignored; rejoin with a new key works.

## Phases and owners

Phase 0 of each step is **one foundation agent that owns every seam file**: `cli/src/serve.ts`, `server/src/create-server.ts`, `security/guard.ts`, `security/register-access-routes.ts`, `core/src/access/**` (device store fields, `signOutAll` kind rule), `core/src/create-core.ts`, `app/App.tsx`, `protocol/**`, the testkit fake and contract tags, the e2e specs and the web fake transport. Owners fill only their folders; needed changes go in a note for the integrator. Agents run on Sonnet, low effort, in worktrees; the orchestrator commits their work.

- **Step 0** (one agent): the mechanical rename and the compatibility items above; green check, test, build, e2e specs (terminal, mvp12-remote, mvp12-machines renamed).
- **Step 1 foundation**: pins p1–p5; protocol (`hello`/`proof`/`ready`/`bye`, parity, `via`, close codes, `linkProtocol`, `Node` with links, commands and coverage test, hash bumps); identity and `node.json`; `peers.json` and migrations; `Settings.setupSkipped`; `Core.nodes` for the real core, `faux-core.ts`, testkit fake with two directions; stubs.
- **Step 1 parallel**: **A** `core/src/nodes/**`; **B** `server/src/nodes/**` (`createLinkPeer`, responder with filter, glare, refusals, revoke both sides, `attachPeer`); **C** `web/src/**` (onboarding gate, Nodes page, wording, redirects and key migration); **D** `cli/src/nodes/**` and connect/disconnect (dialler only, removal of the duplicated link code and tests).
- **Step 1 integration**: e2e with two real servers both ways (A sees B and B sees A; threads, terminals, kill, version skew, revoke each side, migration, glare); docs (README, PLAN.md federation text, AGENTS.md wording); release `0.2.0` with the release skill, with a skew note for 0.1.x nodes; a check that a link over the tunnel host still works and that `/api/n/**` is denied on tunnelled sockets for non-device callers; the user's real run (Mac + vibemachine); verify in a browser on two scratch homes.
- **Step 2 foundation**: pins r1–r6; frame schemas (`announce`, `expel`, `dest`, `trail`, `ttl`, `originSig`); pure `routing.ts` (BFS, ties, live edges, clamping) and signature helpers with tests; fakes with a three-node group; contract tag; stubs.
- **Step 2 parallel**: **E** `core/src/nodes/directory/**` (announces, seq, expiry, topology, tombstones, expel, forget); **F** `server/src/nodes/relay/**` (relay table, id rewrite, per-hop credit, trail/ttl, `originSig` check, destination filter, close propagation); **G** `web/src/**` (directory, "via", Remove, cache for routed nodes); **H** `cli/**` (`nodes list` with hops, `remove`, `forget`).
- **Step 2 integration**: three real servers on scratch homes (chain, triangle, failover, lying announce, expel); then the user's real group; verify in a browser with the phone on the middle node.

## Testing

- Server: MVP12 gateway tests in both directions; parity and reuse; glare and duplicates; responder filter; revoke and `bye` on both sides; Step 2: relay tables, id rewrite on binary frames, per-hop credit, `trail`/`ttl`, `originSig` and replay, destination filter, close propagation, failover.
- Core: peers from both directions; migrations (`hub.json`, device kind, keys); handshake; announce ordering and signatures; BFS ties and mutual edges; cap of 16; tombstones, expel, rejoin, offline sync.
- Web: onboarding gate with the server flag; "Not set up"; no `machine` or `hub` strings; `/m/` redirect and key migration; three-node grouping; "via" as text.
- CLI: connect on a node with peers; disconnect by name; `remove`, `forget`.
- e2e as in the phases.

## Risks

- **Every node controls every node**; expulsion cuts a node off but does not wipe it.
- **Relays read plaintext** of what they forward (no end-to-end encryption between origin and destination).
- **The rename is wide** (269 files); it is its own green commit first.
- **Link refactor** (about 700 lines move from `cli` to `server`): the MVP12 tests run in both directions are the net.
- **Routing bugs** (loops, black holes, stale routes) are the weakest part of Step 2: pure routing module, mutual edges, `trail` and `ttl`, signed headers, a real triangle test.
- **Published 0.1.x nodes** speak the old protocol: they show "Update tau" through the alias; files migrate.
- **Version skew**: `linkProtocol` mismatch splits routing; `PROTOCOL_VERSION` mismatch only blocks opening that node's API. The UI says which nodes need an update.
- **A skipped setup hides a half-configured node**: its row says "Not set up".
