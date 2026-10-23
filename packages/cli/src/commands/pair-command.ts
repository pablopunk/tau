import { CliExit } from "./cli-exit";
import { type CommandEnv, processEnv } from "./command-env";
import { MachineOutput } from "./machine-output";
import { runPairFlow } from "./pair-flow";
import { executeApiCommand, takeHomeFlag } from "./run-command";

const wantsHelp = (argv: readonly string[]) => argv.includes("--help") || argv.includes("-h");

/** `tau pair new …` and help stay with the generic command table. */
const isTableVerb = (argv: readonly string[]) => argv[0] === "new" || argv[0] === "redeem" || wantsHelp(argv);

/** `tau pair [--name <label>]`: link a phone or browser with a link, a short code and a QR. */
export async function executePair(argv: readonly string[], env: CommandEnv): Promise<void> {
  if (isTableVerb(argv)) return executeApiCommand("pair", argv, env);
  if (argv.includes("--machine")) {
    const machine = new MachineOutput(env, "pair");
    throw machine.fail(
      new CliExit(
        1,
        "Interactive pairing is not machine-framed; use remote status/on and pair new --machine explicitly",
        "unsupported",
      ),
    );
  }
  await runPairFlow(argv, env);
}

export async function runPair(argv: readonly string[]): Promise<void> {
  const env = processEnv();
  try {
    const { home, rest } = takeHomeFlag(argv);
    await executePair(rest, home === undefined ? env : { ...env, home });
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    env.stderr(error.message);
    process.exitCode = error.exitCode;
  }
}
