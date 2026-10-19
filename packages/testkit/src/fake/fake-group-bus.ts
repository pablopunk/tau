import type { Expulsion } from "@tau/protocol";

export interface FakeGroupMember {
  readonly id: string;
  readonly name: string;
  /** Applies a verified expel here: the target leaves the lists, a target that is this node is quarantined. */
  applyExpel(record: { target: string; by: string; at: number }): void;
}

interface Record {
  target: string;
  by: string;
  at: number;
  applied: Set<string>;
}

/** The "network" of a fake group: delivers expels to reachable members and remembers who confirmed. */
export interface FakeGroupBus {
  join(member: FakeGroupMember): void;
  members(): readonly FakeGroupMember[];
  /** Delivers to every reachable member (cut ones get it on `reconnect`). */
  expel(by: string, target: string, at: number): void;
  expulsions(): Expulsion[];
  cut(memberId: string): void;
  reconnect(memberId: string): void;
}

export function createFakeGroupBus(): FakeGroupBus {
  const members = new Map<string, FakeGroupMember>();
  const cut = new Set<string>();
  const records: Record[] = [];
  const deliver = (record: Record, member: FakeGroupMember) => {
    if (cut.has(member.id) || record.applied.has(member.id)) return;
    record.applied.add(member.id);
    member.applyExpel({ target: record.target, by: record.by, at: record.at });
  };
  const nameOf = (id: string) => members.get(id)?.name ?? null;
  return {
    join: (member) => void members.set(member.id, member),
    members: () => [...members.values()],
    expel(by, target, at) {
      let record = records.find((entry) => entry.target === target);
      if (!record) {
        record = { target, by, at, applied: new Set() };
        records.push(record);
      }
      for (const member of members.values()) deliver(record, member);
    },
    expulsions: () =>
      records.map((record) => ({
        target: record.target,
        targetName: nameOf(record.target),
        by: record.by,
        byName: nameOf(record.by),
        at: record.at,
        confirmations: [...record.applied]
          .filter((node) => node !== record.target)
          .map((node) => ({
            node,
            name: nameOf(node) ?? node,
            at: record.at,
          })),
        pending: [...members.values()]
          .filter((member) => member.id !== record.target && !record.applied.has(member.id))
          .map((member) => ({ node: member.id, name: member.name })),
      })),
    cut: (memberId) => void cut.add(memberId),
    reconnect(memberId) {
      cut.delete(memberId);
      const member = members.get(memberId);
      if (member) for (const record of records) deliver(record, member);
    },
  };
}
