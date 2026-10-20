import { randomUUID } from "node:crypto";
import {
  AUTO_FIELDS,
  type CommandDef,
  commandOf,
  commands,
  type RouteField,
  routeFields,
  routes,
} from "@tau/protocol";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { usageError } from "./cli-exit";
import { type CommandFlag, commandFlags, flagSpecOf, valueKindOf } from "./command-flags";
import { scanArgs } from "./scan-args";

export interface RouteInputParts {
  readonly params: Record<string, string>;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

export interface ParsedCommand {
  readonly def: CommandDef;
  readonly input: RouteInputParts;
  readonly yes: boolean;
  readonly wait: boolean;
  readonly timeoutSeconds: number;
  readonly home: string | undefined;
}

export const DEFAULT_TIMEOUT_SECONDS = 600;

const NONE = "none";

export function parseModelRef(raw: string): { provider: string; modelId: string } {
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) throw usageError(`Expected provider/modelId, got: ${raw}`);
  return { provider: raw.slice(0, slash), modelId: raw.slice(slash + 1) };
}

function coerce(raw: string | boolean, kind: ReturnType<typeof valueKindOf>, nullable: boolean): unknown {
  if (raw === NONE && nullable) return null;
  if (typeof raw === "boolean") return kind === "booleanString" ? String(raw) : raw;
  if (kind === "model") return parseModelRef(raw);
  if (kind === "number") {
    const value = Number(raw);
    if (Number.isNaN(value)) throw usageError(`Expected a number, got: ${raw}`);
    return value;
  }
  return raw;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  target[path.slice(path.indexOf(".") + 1)] = value;
}

function fieldAt(def: CommandDef, path: string): RouteField | undefined {
  return routeFields(def.route).find((field) => field.path === path);
}

interface Sources {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
}

function targetOf(sources: Sources, path: string): Record<string, unknown> {
  if (path.startsWith("params.")) return sources.params;
  return path.startsWith("query.") ? sources.query : sources.body;
}

function assignPositionals(def: CommandDef, values: readonly string[], sources: Sources): unknown {
  if (values.length < def.positionals.length) {
    const missing = def.positionals.slice(values.length).map((path) => `<${path.split(".").pop()}>`);
    throw usageError(`Missing ${missing.join(" ")}. Usage: tau ${def.command} ${usageOf(def)}`);
  }
  if (values.length > def.positionals.length) {
    throw usageError(`Unexpected argument: ${values[def.positionals.length]}`);
  }
  let wholeBody: unknown;
  def.positionals.forEach((path, index) => {
    const raw = values[index] as string;
    if (path === "body") {
      wholeBody = parseModelRef(raw);
      return;
    }
    const field = fieldAt(def, path);
    const kind = def.modelRefs?.includes(path) ? "model" : field ? valueKindOf(field) : "string";
    setPath(targetOf(sources, path), path, coerce(raw, kind, field?.nullable ?? false));
  });
  return wholeBody;
}

function assignFlags(
  flags: readonly CommandFlag[],
  given: ReadonlyMap<string, string | boolean>,
  sources: Sources,
): void {
  for (const flag of flags) {
    const raw = given.get(flag.name);
    if (raw === undefined || !flag.field || flag.valueKind === "output") continue;
    setPath(
      targetOf(sources, flag.field.path),
      flag.field.path,
      coerce(raw, flag.valueKind, flag.field.nullable),
    );
  }
}

function applyFixed(def: CommandDef, sources: Sources): void {
  for (const [path, value] of Object.entries(def.fixed ?? {})) setPath(targetOf(sources, path), path, value);
}

function defaultRequiredBooleans(def: CommandDef, sources: Sources): void {
  for (const field of routeFields(def.route)) {
    const target = targetOf(sources, field.path);
    if (field.source === "body" && field.required && field.boolean && target[field.name] === undefined) {
      target[field.name] = false;
    }
  }
}

function fillAutoFields(def: CommandDef, body: Record<string, unknown>): void {
  for (const field of routeFields(def.route)) {
    if (field.source === "body" && AUTO_FIELDS.includes(field.name) && body[field.name] === undefined) {
      body[field.name] = randomUUID();
    }
  }
}

/** `tau mcp save docs --json '{…}'`: the body repeats the `name` the positional already gave. */
function fillFromParams(
  def: CommandDef,
  params: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  const bodyNames = routeFields(def.route)
    .filter((field) => field.source === "body")
    .map((field) => field.name);
  for (const [name, value] of Object.entries(params)) {
    if (bodyNames.includes(name) && body[name] === undefined) body[name] = value;
  }
}

function parseJsonBody(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // reported below
  }
  throw usageError("--json needs a JSON object");
}

function checkSchema(schema: TSchema | undefined, value: unknown, label: string): void {
  if (!schema) return;
  const first = Array.from(Value.Errors(schema, value))[0];
  if (!first) return;
  const where = first.instancePath ? `${label}${first.instancePath.replaceAll("/", ".")}` : label;
  throw usageError(`Invalid ${where}: ${first.message}`);
}

function validate(def: CommandDef, input: RouteInputParts): void {
  const route = routes[def.route] as { params?: TSchema; query?: TSchema; body?: TSchema };
  checkSchema(route.params, input.params, "params");
  checkSchema(route.query, input.query, "query");
  checkSchema(route.body, input.body, "body");
}

function parseTimeout(raw: string | boolean | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(raw);
  if (typeof raw === "boolean" || !(seconds > 0)) throw usageError("--timeout needs a number of seconds");
  return seconds;
}

function bodyOf(def: CommandDef, sources: Sources, whole: unknown, json: unknown): unknown {
  const hasBody = (routes[def.route] as { body?: TSchema }).body !== undefined;
  if (!hasBody) return undefined;
  if (typeof json === "string") {
    const body = parseJsonBody(json);
    fillAutoFields(def, body);
    fillFromParams(def, sources.params, body);
    return body;
  }
  if (def.json) throw usageError(`tau ${def.command} needs --json '<body>'`);
  if (whole !== undefined) return whole;
  fillAutoFields(def, sources.body);
  return sources.body;
}

const stringsOf = (record: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));

/** Usage text for the positionals, for example `<id> <text>`. */
export function usageOf(def: CommandDef): string {
  return def.positionals.map((path) => `<${path === "body" ? "model" : path.split(".").pop()}>`).join(" ");
}

/** The command and how many argv words it used: `noun verb` or, for a group like `providers claude-cli refresh`, three. */
export function findCommandIn(noun: string, argv: readonly string[]): { def: CommandDef; words: number } {
  const [verb, sub] = argv;
  const three = verb !== undefined && sub !== undefined ? commandOf(`${noun} ${verb} ${sub}`) : undefined;
  if (three) return { def: three, words: 2 };
  return { def: findCommand(noun, verb), words: 1 };
}

export function findCommand(noun: string, verb: string | undefined): CommandDef {
  const def = verb === undefined ? undefined : commandOf(`${noun} ${verb}`);
  if (def) return def;
  const known = commands
    .filter((entry) => entry.command.startsWith(`${noun} `))
    .map((entry) => entry.command.slice(noun.length + 1));
  throw usageError(`Unknown command: ${noun} ${verb ?? ""}. Try: ${known.join(", ")}`);
}

/** Argv after the verb, the table and the schemas give the route input. Throws a usage error. */
export function parseCommand(def: CommandDef, argv: readonly string[]): ParsedCommand {
  const flags = commandFlags(def);
  const { positionals, flags: given } = scanArgs(argv, flagSpecOf(flags));
  const sources: Sources = { params: {}, query: {}, body: {} };
  const whole = assignPositionals(def, positionals, sources);
  assignFlags(flags, given, sources);
  applyFixed(def, sources);
  defaultRequiredBooleans(def, sources);
  const input: RouteInputParts = {
    params: stringsOf(sources.params),
    query: stringsOf(sources.query),
    body: bodyOf(def, sources, whole, given.get("json")),
  };
  validate(def, input);
  return {
    def,
    input,
    yes: given.get("yes") === true,
    wait: given.get("wait") === true,
    timeoutSeconds: parseTimeout(given.get("timeout")),
    home: typeof given.get("home") === "string" ? (given.get("home") as string) : undefined,
  };
}
