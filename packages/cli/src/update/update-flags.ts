import { parseArgs } from "node:util";

export interface UpdateFlags {
  readonly check: boolean;
  readonly yes: boolean;
  readonly force: boolean;
  readonly noRestart: boolean;
  /** `--target <v>`: install exactly this version. Present means the user typed it; check it with `isPlainVersion`. */
  readonly target: string | undefined;
  /** Only the flags the user typed, forwarded to `tau restart`. */
  readonly forwarded: readonly string[];
}

export function updateFlagsOf(argv: readonly string[]): UpdateFlags {
  const { values } = parseArgs({
    args: [...argv],
    strict: false,
    options: {
      check: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      force: { type: "boolean" },
      "no-restart": { type: "boolean" },
      target: { type: "string" },
      home: { type: "string" },
      port: { type: "string" },
    },
  });
  const forwarded = [
    ...(typeof values.home === "string" ? ["--home", values.home] : []),
    ...(typeof values.port === "string" ? ["--port", values.port] : []),
  ];
  return {
    check: values.check === true,
    yes: values.yes === true,
    force: values.force === true,
    noRestart: values["no-restart"] === true,
    target: typeof values.target === "string" ? values.target : undefined,
    forwarded,
  };
}
