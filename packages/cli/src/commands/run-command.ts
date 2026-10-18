/** Owner A implements the API commands. `noun` is a `COMMAND_NOUNS` entry; `argv` starts after it. */
export async function runApiCommand(noun: string, _argv: readonly string[]): Promise<void> {
  throw new Error(`tau ${noun}: not implemented`);
}
