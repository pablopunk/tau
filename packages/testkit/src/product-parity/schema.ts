import {
  AdmissionReceiptSchema,
  ExecutorKindSchema,
  RuntimeLifecycleSchema,
  routes,
  SendReceiptSchema,
} from "@tau/protocol";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import ledger from "./operations.json";

const operations = new Map(
  [...ledger.operations, ...ledger.streams, ...ledger.browserGestures].map((operation) => [
    operation.id,
    { transport: operation.transport, route: operation.route },
  ]),
);

const Id = Type.String({ minLength: 1 });
const NullableId = Type.Union([Id, Type.Null()]);
const Hash = Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]);
const Status = Type.Union([
  Type.Literal("PASS"),
  Type.Literal("FAIL"),
  Type.Literal("BLOCKED"),
  Type.Literal("UNSUPPORTED"),
]);

const RowFields = {
  id: Id,
  operationId: Id,
  scenarioId: Type.String({ pattern: "^C\\." }),
  assertionIds: Type.Array(Id, { minItems: 1, uniqueItems: true }),
  initialSeed: Type.Object({ version: Type.Literal(1), seed: Type.Integer(), fixtureId: Id }),
  web: Type.Object({ caller: Id, gesture: Id, input: Type.Unknown() }),
  cli: Type.Object({ command: NullableId, argv: Type.Array(Type.String()), input: Type.Unknown() }),
  target: Type.Object({
    nodeId: Id,
    threadId: NullableId,
    requestId: NullableId,
    submissionId: Type.Union([Type.Number(), Type.Null()]),
  }),
  executor: ExecutorKindSchema,
  capability: NullableId,
  permissions: Type.Object({
    decision: Type.Union([
      Type.Literal("allow"),
      Type.Literal("deny"),
      Type.Literal("pending"),
      Type.Literal("not-required"),
    ]),
    confirmed: Type.Boolean(),
  }),
  receipt: Type.Union([SendReceiptSchema, AdmissionReceiptSchema, Type.Null()]),
  terminal: Type.Object({
    lifecycle: Type.Union([RuntimeLifecycleSchema, Type.Null()]),
    observation: Type.Union([Type.Literal("response"), Type.Literal("thread-idle"), Type.Null()]),
    effect: Type.Union([
      Type.Literal("applied"),
      Type.Literal("denied"),
      Type.Literal("none"),
      Type.Literal("unknown"),
    ]),
  }),
  persistedEffects: Type.Array(Type.Object({ path: Id, beforeSha256: Hash, afterSha256: Hash })),
  forbiddenEffects: Type.Array(Id),
  evidence: Type.Object({
    status: Type.Union([
      Type.Literal("classified"),
      Type.Literal("unverified"),
      Type.Literal("blocked"),
      Type.Literal("proved"),
    ]),
    kind: Type.Union([
      Type.Literal("static"),
      Type.Literal("synthetic"),
      Type.Literal("artifact"),
      Type.Literal("live-provider"),
    ]),
    sourceRefs: Type.Array(Id),
    assertions: Type.Array(Type.Object({ id: Id, status: Status })),
  }),
};

export const ProductParityRowSchema = Type.Union([
  Type.Object({ ...RowFields, transport: Type.Literal("rest"), route: Id }, { additionalProperties: false }),
  Type.Object(
    {
      ...RowFields,
      transport: Type.Union([Type.Literal("live"), Type.Literal("terminal"), Type.Literal("gesture")]),
      route: Type.Null(),
    },
    { additionalProperties: false },
  ),
]);

export type ProductParityRow = Static<typeof ProductParityRowSchema>;

export function parseParityRows(value: unknown): readonly ProductParityRow[] {
  if (!Value.Check(Type.Array(ProductParityRowSchema), value)) throw new Error("invalid_parity_rows");
  const ids = new Set<string>();
  for (const row of value) {
    if (row.transport === "rest" && !Object.hasOwn(routes, row.route))
      throw new Error("unknown_parity_route");
    const operation = operations.get(row.operationId);
    if (!operation) throw new Error("unknown_parity_operation");
    if (operation.transport !== row.transport || operation.route !== row.route)
      throw new Error("mismatched_parity_operation");
    if (ids.has(row.id)) throw new Error("duplicate_parity_row");
    ids.add(row.id);
    const assertions = row.evidence.assertions.map(({ id }) => id);
    if (new Set(assertions).size !== assertions.length) throw new Error("duplicate_parity_assertion");
    if (assertions.some((id) => !row.assertionIds.includes(id)))
      throw new Error("undeclared_parity_assertion");
    if (row.terminal.effect === "applied" && row.permissions.decision === "deny") {
      throw new Error("denied_effect_claimed_applied");
    }
  }
  return value;
}
