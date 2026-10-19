# MVP13 plan: nodes (every tau sees every tau it is linked to)

Status: DRAFT v1 (scope talk with the user first, then review rounds). Builds on MVP12 Stage 2 (machines, federation). Nothing below is verified against the code yet except the facts marked with a file.

## Goal

> I link two taus once. From either one, in any browser or on my phone, I see both machines' threads and can work on either. There is no "hub" and no "machine": every tau is a **node**.

## What exists (MVP12) and what is wrong with it

- A link is one WebSocket dialled by the machine (`cli/src/machines/link-client.ts`) to `GET /api/machines/link` on the hub (`server/src/machines/register-link.ts`). Requests flow **hub → machine only**: the hub's gateway sends `request` and `open` frames (`protocol/src/machine-link.ts`); the machine answers by calling **its own server on loopback** with its master token.
- `protocol/src/machine-rules.ts`: a linked tau refuses links (no chains), a tau with machines refuses `tau connect` (no loops), one hub per tau (`hub.json`).
- Result (seen on 2026-10-19): a phone paired to vibemachine, which is linked to the Mac, shows first-run onboarding with no threads, because vibemachine knows the Mac only as a name and a URL.

## Scope

In:
1. **Symmetric link.** The same WebSocket carries requests in both directions. After `tau connect`, each side lists the other as a node in Settings → Machines and in the sidebar, with the same grouping, OS icon, offline cache and update state as today.
2. **One peer implementation.** Both ends run the same multiplexer (request, stream, credit flow) and the same responder (answers by calling its own server on loopback). The duplicate in `cli/src/machines/link-*` goes away; the dialler only opens the socket.
3. **Many links per node.** A node may dial several nodes and accept several. At most one link per pair. No transitive routing in this plan (a request that arrives over a link is never forwarded to another link), so no loop is possible; the chain and loop refusals are removed.
4. **Onboarding with peers.** A node that has a linked, online peer lets the user skip first-run setup ("Use my other machines") and reach the sidebar. Setup still decides whether this node can run threads itself.
5. **Words.** "Hub" disappears from UI, CLI and docs ("Linked to Mac" becomes a node list). `tau connect`, `tau disconnect [node]`, `tau machines` stay.

Out (later plans): routing through a third node (A sees C because B links to both); a group-wide node list; per-link permissions or scopes; a second factor; threads that move between nodes; direct LAN links.

## Design

### Protocol (frames stay, rules change)

- **Stream ids**: the dialler allocates odd ids, the acceptor even ids (today the hub allocates all). `credit`, `close` and data frames are unchanged and symmetric.
- `hello` is sent by **both** ends (name, os, tauVersion, protocolVersion, threadCount, and a stable `nodeId` from `<home>/node.json`). A different `protocolVersion` closes the link on both sides (`LINK_CLOSE_UPDATE_REQUIRED`, 4001) and each side shows "Update tau on <node>".
- `request.hubDevice` becomes `via`: the label of whoever acted (a device name, or the peer node's name for requests started by that node's own UI users); set as header `x-tau-via` on the loopback call (the responder logs it).
- `PROTOCOL_VERSION` is bumped (`bump-protocol`).

### Server: one symmetric peer (`server/src/machines/**`)

- `createLinkPeer({ socket, role, localPort, token, ... })` replaces the hub-only `link-session.ts` and the CLI's `link-session/link-request/link-socket/link-sender`. It exposes the `MachineGateway` methods (`request`, `openStream`, `isOnline`, `closeMachine`) for the remote side and runs the responder for the remote side's requests. The responder uses `createServer`'s own token and port (the server already holds both).
- The same path filter and header allow-lists apply in **both** directions (`path-filter.ts`: only `routes` templates plus `/api/live` and the terminal stream; denylist `access`, `remote`, `machines`, `pair`, `health`; `set-cookie` dropped; `Host`, `Origin`, `Cookie`, `Authorization` never forwarded). `/api/m/**` is not in the allow-list, so a request that came over a link cannot be forwarded to a second link (pin p3).
- `register-link.ts`: the guard still accepts a machine secret only on exactly `GET /api/machines/link` with `Upgrade: websocket`. The acceptor's `acceptLinkRefusal` is removed; a second link from a node it already has is refused with 409-like close 1008 "already linked".
- The dialler (`cli/src/machines/link-client.ts`) keeps reconnect, backoff, `hub.json` polling and `reportLink`, and hands the open socket to `createLinkPeer`.

### Core and files

- `Core.machines` lists **peers**: accepted ones (machine devices, as today) and dialled ones (new, from `peers.json`). The list id is local to the viewing node (the URL `/m/<id>` is always relative to the node the browser talks to).
- `<home>/hub.json` becomes `<home>/peers.json`, a list of `{ url, name, secret }` (mode 0600, atomic). **Migration**: an existing `hub.json` (0.1.x) is read once, written as a one-entry `peers.json`, then deleted. `tau disconnect` with one peer needs no argument; with several it needs a name.
- Dialled peers get the same summary cache as accepted ones (`<home>/machines/<id>/summary.json`, titles and times only), written by the same `summary-writer` while the link is healthy.
- `HubLink` ("Linked to X" on the machine) is replaced by `Machine.direction: "accepted" | "dialled"`; settings show both lists in one table. Fakes, contract tag and web fake transport follow.

### Web

- `useMachines()` already lists linked machines for the hub's UI; it now returns the node's peers whichever way the link was made. No new provider design: the per-machine providers, URLs (`/m/:machineId/...`), grouping and offline state stay.
- **Onboarding gate** (`web/src/setup/**`): with at least one online peer a "Use my other machines" action leaves the wizard and sets a per-browser flag; the node's own setup stays available from the "This machine" group ("Set up this machine"). Without peers, nothing changes.
- Settings → Machines: "Connect a machine" works on every node (it already mints a machine pairing); the "Linked to <hub>" row and the hub badge are removed; rows say "Linked by you" or "Linked to you" only in a tooltip. The connect dialog's warning says it plainly: **both machines get full power over each other**.

### Security (the main risk)

- A link now gives **each side the owner's power on the other** (terminals, agents, files). Before, a compromised machine could not reach the hub. Mitigations are unchanged (denylist keeps the peer away from devices, remote and linking; revoke; no master token over a tunnel) plus: revoking a node on either side closes the link and all proxied streams on **both** sides; the `via` label is logged on the acting side.
- The user decided (MVP12) that a linked device has full power; this extends it to nodes. No scopes yet.

### CLI

`tau connect <link|code> [--name]` is allowed on any node (the refusals go away; "already linked to this node" stays). `tau disconnect [name]`, `tau machines list` shows `direction`. The two commands that said "hub" in help text are renamed. Coverage test and `COMMAND_EXCLUSIONS` updated on purpose.

## Phase 0 pins (foundation runs these first; results in this doc)

- (p1) A request from the dialler to the acceptor over an **existing** link (reverse direction) works for a GET, a 5 MB response, a 42 MB body, 20 parallel requests, `/live` and a binary terminal stream, with odd and even stream ids interleaved and credit flow unchanged. Spike on two scratch homes, loopback.
- (p2) Both ends run requests at once under load: a stalled stream in one direction does not stall the other.
- (p3) A request that arrived over a link and targets `/api/m/<id>/...` is refused (404/403) on the responder: no forwarding, no loop.
- (p4) `hub.json` → `peers.json` migration: an existing 0.1.x file links again without the user doing anything.
- (p5) The responder on the acceptor uses its own token on loopback and the guard sees an untagged socket (same as the CLI link client today).

## Phases and owners

0. **Foundation** (one agent): pins; protocol (`machine-link.ts` ids and `hello`, `via`, `Machine.direction`, routes, commands and the coverage test, bump hash); `Core.machines` for peers; `peers.json` store with migration; fakes and contract; web fake transport with two directions; stubs.
1. **Parallel**:
   - **A** `core/src/machines/**` (peers from both directions, summaries, `peers.json` use).
   - **B** `server/src/machines/**` (`createLinkPeer`, responder, both-way proxy, refusals, revoke on both sides).
   - **C** `web/src/**` (onboarding skip, Machines page and wording, tests with two-direction fakes).
   - **D** `cli/src/machines/**` and `commands/connect-command.ts` (dialler only, `tau connect|disconnect`, remove duplicated link code and its tests).
2. **Integration**: e2e with two real built servers on scratch homes: link B→A; A sees B **and B sees A**; open a thread both ways; terminal both ways; kill one; version skew; revoke on each side; `hub.json` migration. Then the user's real run (Mac + vibemachine).
3. **Verify for real**: build, browser on this Mac with two scratch homes; the user pairs the phone to **either** node and sees both.

## Testing

- Server: symmetric multiplexer tables (every case of MVP12's gateway tests run in both directions); odd/even ids; refusal of a second link per pair; path filter in both directions; revoke closes both sides.
- Core: peers list merges both directions; summaries; migration; status derivation.
- Web: onboarding skip, two-node grouping from both views, no "hub" strings (grep test).
- CLI: connect on a node that has peers; disconnect by name.
- e2e as above.

## Risks

- **Mutual full power** (see Security).
- **Big refactor of the link code** (about 700 lines in `cli/src/machines` move to `server`): the MVP12 tests, run in both directions, are the safety net.
- **Published 0.1.x nodes** talk the old one-way protocol: the protocol hash changes, so they show "Update tau" until updated; the migration protects the files.
- **Setup skip hides a half-configured node**: the node's own row must say "not set up" until providers exist.

## Questions for the user

1. Mutual full power between linked nodes: OK (no scopes yet)?
2. Onboarding: "Use my other machines" skip when a peer is online, with the node's own setup still available. OK?
3. Keep the word "machine" in the UI, or switch to "node"?
4. Transitive routing (A sees C through B) later, not now. OK?
