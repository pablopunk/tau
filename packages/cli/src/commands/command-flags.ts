import { type CommandDef, flagNameOf, isModelRefNode, type RouteField, routeFields } from "@tau/protocol";
import type { FlagKind, FlagSpec } from "./scan-args";

export type ValueKind = "model" | "boolean" | "booleanString" | "number" | "string";

export interface CommandFlag {
  readonly name: string;
  readonly kind: FlagKind;
  readonly valueKind: ValueKind | "output";
  readonly summary: string;
  /** The route field this flag fills; none for the flags every command has. */
  readonly field?: RouteField;
}

export const WAIT_COMMANDS: readonly string[] = ["threads start", "threads send"];

const COMMON_FLAGS: readonly CommandFlag[] = [
  {
    name: "json",
    kind: "value",
    valueKind: "output",
    summary: "Whole request body as JSON (replaces the flags)",
  },
  { name: "yes", kind: "boolean", valueKind: "output", summary: "Confirm a destructive command" },
  {
    name: "home",
    kind: "value",
    valueKind: "output",
    summary: "Tau data home (default: TAU_HOME or ~/.tau)",
  },
];

const KEEP_FLAG: CommandFlag = {
  name: "keep",
  kind: "value",
  valueKind: "string",
  summary: "Device ids to keep, comma separated (default: none; your own device is always kept)",
};

const WAIT_FLAGS: readonly CommandFlag[] = [
  {
    name: "wait",
    kind: "boolean",
    valueKind: "output",
    summary: "Wait until the thread is done, then print the answer",
  },
  { name: "timeout", kind: "value", valueKind: "output", summary: "Seconds to wait (default 600)" },
];

const isLiteralBooleanString = (field: RouteField): boolean =>
  field.node.anyOf?.every((member) => member.const === "true" || member.const === "false") ?? false;

export function valueKindOf(field: RouteField): ValueKind {
  if (isModelRefNode(field.node)) return "model";
  if (isLiteralBooleanString(field)) return "booleanString";
  if (field.boolean) return "boolean";
  const type = field.node.type;
  return type === "number" || type === "integer" ? "number" : "string";
}

const isFlagField = (def: CommandDef, field: RouteField): boolean =>
  !def.positionals.includes(field.path) &&
  def.fixed?.[field.path] === undefined &&
  (field.primitive || isModelRefNode(field.node));

function flagOf(field: RouteField): CommandFlag {
  const valueKind = valueKindOf(field);
  const isBoolean = valueKind === "boolean" || valueKind === "booleanString";
  return {
    name: flagNameOf(field.name),
    kind: isBoolean ? "boolean" : "value",
    valueKind,
    field,
    summary: `${field.required ? "Required. " : ""}${field.source} field ${field.name}`,
  };
}

export function commandFlags(def: CommandDef): readonly CommandFlag[] {
  const fieldFlags = routeFields(def.route)
    .filter((field) => isFlagField(def, field))
    .map(flagOf);
  const waitFlags = WAIT_COMMANDS.includes(def.command) ? WAIT_FLAGS : [];
  const extra = def.command === "access rotate" ? [KEEP_FLAG] : [];
  return [...fieldFlags, ...extra, ...waitFlags, ...COMMON_FLAGS];
}

export const flagSpecOf = (flags: readonly CommandFlag[]): FlagSpec =>
  Object.fromEntries(flags.map((flag) => [flag.name, flag.kind]));
