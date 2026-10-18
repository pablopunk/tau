import { usageError } from "./cli-exit";

export type FlagKind = "boolean" | "value";
export type FlagSpec = Readonly<Record<string, FlagKind>>;

export interface ScannedArgs {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

const NEGATION = /^no-(.+)$/;

function booleanNameOf(name: string, spec: FlagSpec): { name: string; value: boolean } | undefined {
  if (spec[name] === "boolean") return { name, value: true };
  const negated = NEGATION.exec(name)?.[1];
  if (negated !== undefined && spec[negated] === "boolean") return { name: negated, value: false };
  return undefined;
}

/** `--flag value`, `--flag=value`, `--flag` / `--no-flag` for booleans, `--` ends the flags. */
export function scanArgs(argv: readonly string[], spec: FlagSpec): ScannedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const [rawName, inline] = splitInline(token.slice(2));
    const boolean = booleanNameOf(rawName, spec);
    if (boolean && inline === undefined) {
      flags.set(boolean.name, boolean.value);
      continue;
    }
    if (spec[rawName] !== "value") throw usageError(`Unknown flag: --${rawName}`);
    const value = inline ?? argv[++index];
    if (value === undefined) throw usageError(`Flag --${rawName} needs a value`);
    flags.set(rawName, value);
  }
  return { positionals, flags };
}

function splitInline(text: string): [string, string | undefined] {
  const at = text.indexOf("=");
  return at < 0 ? [text, undefined] : [text.slice(0, at), text.slice(at + 1)];
}
