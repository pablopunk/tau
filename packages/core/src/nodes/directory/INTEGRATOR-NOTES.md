# Integrator notes (Owner E)

- `DirectoryDeps` has no self info (name, os, tauVersion, protocolVersion, linkProtocol), so announces would carry defaults (`tauVersion: "unknown"`). `createDirectory` accepts `DirectoryDepsWithSelf` (`self?: () => SelfInfo`, in `sign-frames.ts`). In `create-core.ts` pass `self: async-free` values: name `hostname()` without `.local`, os `${platform} ${arch}`, `options.currentVersion`, the protocolVersion used for `createNodes`, `LINK_PROTOCOL`. Or add it to `DirectoryDeps` in `ports.ts`.
- `NodeIdentity` exposes only `sign`, so frames are built in `sign-frames.ts` with the same bytes as `createAnnounce/createExpel/createAck` (protocol). Keep both in step if the payload format changes.
- Server (F): the directory does NOT cut links. After `acceptExpel`/`createExpel` the server must flood first, then close; `deps.nodes.forget(target)` is already called by the directory when a tombstone is learned (it removes the peer from the list, so flood before the peer vanishes from `nodes.list`: the directory calls forget right after storing, so F should flood from the frame it holds, not from `list`).
- Expiry has no timer: it is checked on `localAnnounce` (every 15 s) and on `directory()`. Expiry fires `onTopology` there.
- Acks and skew are in memory only; after a restart `expulsions()` shows confirmations as unknown until acks arrive again (our own ack is re-added only for fresh expels).
- Unsynced reasons: a `fromPeerId` not passed to `linkUp` (never linked, or no `announce` capability) is refused as `capability`; `not-linked` is unused.
- Per-`by` quota (32) and the 256 cap are reported as `reason: "capacity"` on an incoming expel; `createExpel` maps it to `rate_limited`.
- `nodes.reset()` (remote disable/recreate) does not call `directory.reset()`: tombstones are kept, as decided.
- Real-core `[nodes-group]` cases need `group()` on the real contract target (a three-core harness with a link simulation); not done here. `directory/test-network.ts` is a working in-memory example of the server's role.
