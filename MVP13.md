# MVP13 plan: nodes (every tau sees every tau in its group)

Status: DRAFT v2 (scope agreed with the user; review rounds pending). Builds on MVP12 Stage 2 (machines, federation). Facts marked with a file were read; everything else is a proposal for the reviewer to attack.

## Goal

> I link taus once. From any node, in any browser or on my phone, I see the threads of **every** node in the group and can work on any of them, even when no direct link exists (A–B and B–C means A sees C). There is no "hub" and no "machine": every tau is a **node**.

## What exists (MVP12) and what is wrong with it

- A link is one WebSocket dialled by the machine (`cli/src/machines/link-client.ts`) to `GET /api/machines/link` on the hub (`server/src/machines/register-link.ts`). Requests flow **hub → machine only**: the hub's gateway sends `request` and `open` frames (`protocol/src/machine-link.ts`, stream ids allocated by the hub); the machine answers by calling **its own server on loopback** with its master token.
- `protocol/src/machine-rules.ts`: a linked tau refuses links (no chains), a tau with machines refuses `tau connect` (no loops), one hub per tau (`hub.json`).
- Seen on 2026-10-19: a phone paired to vibemachine (linked to the Mac) shows first-run onboarding and no threads, because vibemachine knows the Mac only as a name and URL.

## Decisions (agreed with the user)

1. **Full power in all directions**, no scopes: every linked node has the owner's power on every other node in its group.
2. **Onboarding** is per node, once, and only when the node cannot run threads yet (no provider). A node with a reachable peer may skip it ("Use my other nodes"); its own setup stays available.
3. The word is **node** (UI, CLI, URLs, code).
4. **Propagation**: every node learns every other node in the group and can reach it through intermediate nodes.

## Scope

Two stages. Stage 2 starts after Stage 1 passes check, test, build, e2e.

### Stage 1: symmetric links, one peer, nodes

1. The same WebSocket carries requests **both ways**; after `tau connect` each side lists the other.
2. **One peer implementation** (multiplexer + responder) in `server`, used by both ends; the duplicate in `cli/src/machines/link-*` goes away; the dialler only opens the socket.
3. Many links per node (dial several, accept several), at most one per pair; the chain and loop refusals go; **no forwarding yet** (a request that arrives over a link stays on that node).
4. Onboarding skip with a reachable peer.
5. Rename machine → node: UI, CLI (`tau nodes`, `tau connect`, `tau disconnect [node]`; `tau machines` stays as an alias for one release), URLs (`/n/:nodeId/...`; `/m/...` redirects), code identifiers (a mechanical rename in Phase 0), published 0.1.x files (`hub.json`) migrate.

### Stage 2: group propagation and routing

6. A **node directory**: every node learns every node of the group (name, OS, version, status, thread count, links) and shows it in the sidebar and Settings → Nodes.
7. **Routed requests and streams**: a request or stream for a node that is not a neighbour is relayed hop by hop to it (`/live`, terminals, 42 MB bodies included).
8. Failover: when a link drops, routes are recomputed; a node reachable over another path stays online.

Out (later plans): per-link permissions or scopes; a second factor; **removing a node from the whole group in one action** (see Risks: today you cut every link of it); threads that move between nodes; direct LAN links; a group larger than 16 nodes.

## Design, Stage 1

### Protocol

- **Stream ids**: the dialler allocates odd ids, the acceptor even ids. `credit`, `close`, data frames unchanged and symmetric.
- `hello` is sent by **both** ends: `nodeId` (stable random id, `<home>/node.json`, never reused), name, os, tauVersion, protocolVersion, threadCount. A different `protocolVersion` closes the link on both sides (4001); each shows "Update tau on <node>".
- `request.hubDevice` becomes `via`: label of whoever acted (a device name, or `<node name>` for a request started by that node's own users); header `x-tau-via` on the loopback call; logged by the responder.
- `PROTOCOL_VERSION` bumped (`bump-protocol`).

### Server: one symmetric peer (`server/src/machines/**` → `nodes/**`)

- `createLinkPeer({ socket, role, localPort, token })` replaces the hub-only `link-session.ts` and the CLI's `link-session/request/socket/sender`. It exposes the gateway methods (`request`, `openStream`, `isOnline`, `close`) for the remote side and runs the responder for the remote side's requests, calling its own server on loopback with the server's own token (the server already holds token and port).
- Path filter and header allow-lists (`path-filter.ts`) apply in **both** directions: only `routes` templates plus `/api/live` and the terminal stream; denylist `access`, `remote`, `nodes`, `pair`, `health`; `set-cookie` dropped; `Host`, `Origin`, `Cookie`, `Authorization` never forwarded. In Stage 1 `/api/n/**` is not allowed through a link (no forwarding); Stage 2 changes this on purpose.
- The guard still accepts a node secret only on exactly `GET /api/nodes/link` with `Upgrade: websocket` (machine branch unchanged, renamed). A second link from the same `nodeId` is refused ("already linked") and so is a link to itself (`nodeId` equal).
- Revoke or disconnect on either side closes the link and every proxied stream on **both** sides.

### Core and files

- `Core.nodes` lists **peers** from both directions (accepted: node devices; dialled: `peers.json`). The list id is the peer's `nodeId` (global, stable): a URL `/n/<nodeId>` means the same node from every viewpoint.
- `<home>/hub.json` → `<home>/peers.json`, `{ url, name, nodeId, secret }[]` (0600, atomic). **Migration**: a 0.1.x `hub.json` is read once, written as a one-entry `peers.json`, deleted. Accepted peers keep their node device; the device store migrates kind `machine` → `node`. A node that has no `node.json` creates it at start.
- Offline cache per known node (`<home>/nodes/<nodeId>/summary.json`, titles and times only), fed by the same summary writer while the link is healthy.
- `HubLink` ("Linked to X") is replaced by `Node.links: { direction, state }` ; the machines page shows one table.

### Web

- Per-node providers, grouping, offline state, OS icons, `/n/:nodeId/...` URLs as in MVP12; `useNodes()` returns the node's peers (Stage 2: the whole group).
- **Onboarding gate** (`web/src/setup/**`): with a reachable peer, "Use my other nodes" leaves the wizard (per-browser flag); this node's row says "Not set up" with a "Set up" action until a provider exists. Without peers, nothing changes.
- Settings → Nodes: "Connect a node" on every node; hub badge and "Linked to <hub>" removed; the dialog says plainly **every node in the group gets full power over every other**.

### CLI

`tau connect <link|code> [--name]` allowed everywhere ("already linked" and "yourself" refusals stay). `tau disconnect [node]`, `tau nodes list|rename|disconnect`. Coverage test and `COMMAND_EXCLUSIONS` updated on purpose; destructive list unchanged in size.

## Design, Stage 2: propagation and routing

### Node directory (link-state, flooded)

- Each node announces **itself** with `announce { origin: nodeId, seq, name, os, tauVersion, protocolVersion, threadCount, neighbours: nodeId[], ttl }` on link-up, on any change of its own record or neighbours, and every 15 s (heartbeat). `seq` is a per-origin counter persisted across restarts (a restart that loses it uses time-based seq `Date.now()`).
- A node stores the highest `seq` per origin, drops older or equal ones, and **re-floods** to every link except the one it came from (ttl decremented; ttl starts at 8). An origin not heard from for 45 s is `offline`; one whose `protocolVersion` differs is `update-required`.
- Each node builds the **topology graph** from the neighbour lists and computes shortest paths (BFS, hop count; ties by lowest `nodeId`) to every origin. The directory is that table: `{ nodeId, name, os, ..., status, nextHop: linkId, hops }`.
- A group is capped at **16 nodes**; a 17th announcement is ignored and shown as a warning. Announce traffic is O(nodes × links) every 15 s: small.
- Only nodes with the **same `protocolVersion`** exchange announces; a link to a node with another version carries nothing but a "needs update" status.

### Routed requests and streams

- `request` and `open` frames gain `dest: nodeId` and `trail: nodeId[]` (nodes already passed) and `ttl`. A node that is not `dest` looks up `nextHop`, **relays** onto that link with a **new stream id of its own on that link**, keeps a table `(inLink, inId) ↔ (outLink, outId)`, and copies data frames both ways. A node refuses a frame whose `trail` contains its own `nodeId` or whose `ttl` reached 0 (no loops even while routes converge).
- Flow control stays **per hop**: every link has the credit window of MVP12; a relay forwards a chunk only when the outgoing link has credit and returns credit upstream only after the chunk was sent downstream; so a slow browser at the far end slows only its own stream, and a relay buffers at most one window per stream. 60 s without credit closes the stream (1013) on that hop and the close propagates.
- **The destination enforces the path filter** (relays forward opaque and never parse bodies); the origin also filters (early rejection). A relay only checks the frame header and the `trail`.
- `x-tau-via` carries the chain of labels (`device name via NodeB`) for audit on the destination.
- Revoke or disconnect closes the streams that use that link on every hop (each relay closes the matching pair).
- Failover: a link drop recomputes routes; streams that used it close with 1013 (the web already reconnects `/live`); new requests use the new path.

### Web (Stage 2)

- `useNodes()` returns the **directory**; a node that is not a neighbour shows exactly like one, with a "via B" tooltip. The per-node provider's `Transport` prefixes `/api/n/<nodeId>` as today; the first node (the one the browser talks to) resolves the route.
- The sidebar groups by node as now; the offline cache covers every known node (fed by the routed summary writer, at most every 15 s per node).
- Settings → Nodes shows hops and "via". "Disconnect" acts on **this node's** link only and says so.

## Security (the main risk)

- A link gives each side the owner's power on the other, and with propagation **every node has owner power on every node it can route to**. Joining one node means trusting the whole group. The link dialog says it.
- Mitigations unchanged: the denylist keeps a peer away from devices, remote and linking; no master token over a tunnel; revoke closes both sides; the `via` chain is logged on the destination.
- **Weak spot**: there is no "kick this node out of the group". Cutting one link does not stop a node that still has another path. Stage 2 ships `tau nodes forget <id>` only as a **local** action (it closes this node's links to it and ignores its announces for 24 h); real expulsion is a later plan. The risk is stated in Settings.
- Announces are **unauthenticated beyond the link**: a malicious node can lie about other nodes (names, neighbours) and attract routes. Accepted for a trusted group; a test shows a lying announce cannot make a node accept a request for a different `dest`, and that a node never trusts an announce about itself.

## Phase 0 pins (foundation runs these first; results in this doc)

Stage 1:
- (p1) A request from the dialler to the acceptor over an existing link (reverse direction) works for a GET, a 5 MB response, a 42 MB body, 20 parallel requests, `/live` and a binary terminal stream, with odd and even ids interleaved; a stalled stream in one direction does not stall the other.
- (p2) The responder on the acceptor uses its own token on loopback and the guard sees an untagged socket.
- (p3) `hub.json` → `peers.json`, kind `machine` → `node` migration from a real 0.1.x home.
- (p4) The mechanical rename: `tsc`, tests, the protocol hash, the e2e specs and the web URL redirect `/m/...` → `/n/...`.

Stage 2:
- (r1) Three real built servers on scratch homes (A–B–C chain): A sees C within 20 s; a GET, a terminal stream and a 42 MB body from A reach C through B; kill B: C goes offline on A within 45 s; add a link A–C: C stays reachable after B dies (failover).
- (r2) Loop: link A–B, B–C, C–A (triangle): no frame circulates, `trail` and `ttl` stop a forged looping frame (test), announces converge.
- (r3) A lying announce (wrong neighbours, huge counts, ttl 255, an announce about the receiver itself) is bounded: sizes capped, ttl clamped to 8, self-announce ignored.
- (r4) Credit flow across two hops: stalled browser at the far end, 20 other requests unaffected; memory per relayed stream stays within the window.
- (r5) Group cap of 16 and the 17th node warning.

## Phases and owners

### Stage 1
0. **Foundation** (one agent, owns every seam file): the mechanical rename; pins p1–p4; protocol (`hello` both ways, ids odd/even, `via`, `Node` with `links`, routes `/api/nodes/**`, commands, coverage test, hash bump); `peers.json` store and migrations; `Core.nodes` for the real core, `faux-core.ts`, testkit fake with two directions; stubs.
1. **Parallel**: **A** `core/src/nodes/**`; **B** `server/src/nodes/**` (`createLinkPeer`, responder, refusals, revoke both sides); **C** `web/src/**` (onboarding skip, Nodes page, wording, redirects); **D** `cli/src/nodes/**` and the connect/disconnect commands (dialler only, removal of the duplicated link code and tests).
2. **Integration**: e2e two real servers both ways (A sees B and B sees A; threads, terminals, kill, version skew, revoke on each side, migration), then the user's real run (Mac + vibemachine).
3. **Verify for real**: build, browser on this Mac with two scratch homes; pair a phone to either node and see both.

### Stage 2
0. **Foundation**: pins r1–r5 (spike), frame schemas (`announce`, `dest`, `trail`, `ttl`), directory and routing interfaces with a pure, tested `routing.ts` (BFS, ties, failover, clamping), fakes with a three-node group, contract tag.
1. **Parallel**: **E** `core/src/nodes/directory/**` (announce handling, seq, expiry, topology, `forget`); **F** `server/src/nodes/relay/**` (relay table, per-hop credit, trail/ttl checks, destination filter, close propagation); **G** `web/src/**` (directory in `useNodes`, "via", cache for routed nodes); **H** `cli/**` (`tau nodes list` with hops, `forget`).
2. **Integration**: three real servers on scratch homes (chain, triangle, failover, lying announce); then the user's real group.
3. **Verify for real**: browser, three nodes, phone on the middle node.

## Testing

- Server: MVP12's gateway tests run in both directions; odd/even ids; second link per node refused; self link refused; path filter in both directions; revoke closes both sides; Stage 2: relay tables, per-hop credit, `trail` and `ttl`, destination filter, close propagation, failover.
- Core: peers from both directions; migration; announce ordering (`seq`), expiry, restart seq; BFS ties; cap of 16; lying announces.
- Web: onboarding skip; "Not set up" row; no "machine" or "hub" strings (grep test); `/m/` redirect; three-node grouping; "via" tooltip.
- CLI: connect on a node with peers; disconnect by name; `forget`.
- e2e as in the phases.

## Risks

- **Every node controls every node** (see Security), plus no group-wide expulsion.
- **The rename is wide** (protocol routes, files, UI, URLs, published 0.1.x); the foundation does it mechanically and the hash, tests and redirects prove it.
- **Link refactor** (about 700 lines move from `cli` to `server`): the MVP12 tests run in both directions are the net.
- **Routing bugs** (loops, black holes, stale routes) are the weakest part of Stage 2: pure routing module, `trail` and `ttl` as a second line, real triangle test.
- **Published 0.1.x nodes** speak the old protocol: they show "Update tau"; files migrate.
- **Version skew splits the group**: a node with another protocol version is not routed through; the UI says which nodes need an update.
- **Setup skip hides a half-configured node**: its row says "Not set up".
