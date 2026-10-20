const SEGMENT_SPLIT = /&&|\|\||[;|\n]/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PLAIN_WRAPPERS = new Set(["time", "command", "nohup", "exec", "sudo"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const VALUE_FLAGS = new Set(["--filter", "-F", "-C", "--dir", "--prefix", "--workspace", "-p", "-c"]);
const WATCH_FLAGS = new Set(["--watch", "-w", "--watchAll", "--watchall", "--ui"]);
const WATCH_WORDS = new Set(["watch", "dev", "serve", "start"]);
const SCRIPT_PATTERN = /(test|build|check|lint|typecheck|e2e)/;

const GO_AND_CARGO = new Map<string, readonly string[]>([
  ["cargo", ["build", "test", "check", "clippy"]],
  ["go", ["build", "test"]],
  ["docker", ["build"]],
  ["biome", ["check"]],
  ["playwright", ["test"]],
  ["vitest", ["run"]],
]);
const ALWAYS_HEAVY = new Set(["jest", "pytest", "tsc", "eslint", "gradle", "mvn", "make"]);

const isWatchWord = (word: string) => WATCH_WORDS.has(word) || /:(watch|dev|serve|start)$/.test(word);

interface Parsed {
  readonly flags: string[];
  readonly words: string[];
}

function parseArguments(tokens: readonly string[]): Parsed {
  const flags: string[] = [];
  const words: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] as string;
    if (VALUE_FLAGS.has(token)) index++;
    else if (token.startsWith("-")) flags.push(token);
    else words.push(token);
  }
  return { flags, words };
}

/** Drops env assignments and wrappers such as `time`, `env`, `npx`, `mise exec --`. */
function stripWrappers(tokens: readonly string[]): string[] {
  let rest = [...tokens];
  for (;;) {
    const head = rest[0];
    if (head === undefined) return rest;
    if (ENV_ASSIGNMENT.test(head) || PLAIN_WRAPPERS.has(head)) rest = rest.slice(1);
    else if (head === "env" || head === "npx" || head === "bunx") {
      rest = rest.slice(1);
      while (rest[0] !== undefined && (rest[0].startsWith("-") || ENV_ASSIGNMENT.test(rest[0]))) {
        rest = rest.slice(1);
      }
    } else if (head === "mise" && rest[1] === "exec") {
      const separator = rest.indexOf("--");
      rest = separator < 0 ? [] : rest.slice(separator + 1);
    } else return rest;
  }
}

function runnerIsHeavy(head: string, words: readonly string[]): boolean {
  if (ALWAYS_HEAVY.has(head)) return true;
  const subcommands = GO_AND_CARGO.get(head);
  return subcommands !== undefined && words[0] !== undefined && subcommands.includes(words[0]);
}

function packageScriptIsHeavy(words: readonly string[]): boolean {
  const [first, second] = words;
  const script = first === "run" || first === "run-script" ? second : first;
  return script !== undefined && SCRIPT_PATTERN.test(script);
}

function segmentIsHeavy(segment: string): boolean {
  const tokens = stripWrappers(segment.trim().split(/\s+/).filter(Boolean));
  const head = tokens[0];
  if (head === undefined) return false;
  if (PACKAGE_MANAGERS.has(head)) return packageManagerIsHeavy(tokens);
  const { flags, words } = parseArguments(tokens.slice(1));
  if (flags.some((flag) => WATCH_FLAGS.has(flag)) || words.some(isWatchWord)) return false;
  return runnerIsHeavy(head, words);
}

function packageManagerIsHeavy(tokens: readonly string[]): boolean {
  const { flags, words } = parseArguments(tokens.slice(1));
  if (flags.some((flag) => WATCH_FLAGS.has(flag))) return false;
  if (words[0] === "exec" || words[0] === "dlx") {
    const at = tokens.indexOf(words[0]);
    return segmentIsHeavy(tokens.slice(at + 1).join(" "));
  }
  if (words.slice(1).some(isWatchWord) || (words[0] !== undefined && isWatchWord(words[0]))) return false;
  return packageScriptIsHeavy(words);
}

/**
 * Whether a shell command looks like a test, build, typecheck or lint run. Unknown is not heavy.
 * Known fail-open case: `pnpm -w test` (workspace root) reads as a watch flag.
 */
export function isHeavyCommand(command: string): boolean {
  return command.split(SEGMENT_SPLIT).some(segmentIsHeavy);
}
