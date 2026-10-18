import type { CommandResult, Runner } from "./runner";

export interface FakeRunner extends Runner {
  readonly calls: string[];
  readonly detached: string[];
}

type Responder = (line: string) => Partial<CommandResult> | undefined;

/** Records every command as one line; `respond` can fail or answer chosen ones. */
export function createFakeRunner(respond: Responder = () => undefined): FakeRunner {
  const calls: string[] = [];
  const detached: string[] = [];
  return {
    calls,
    detached,
    async run(command, args) {
      const line = [command, ...args].join(" ");
      calls.push(line);
      return { code: 0, stdout: "", stderr: "", ...respond(line) };
    },
    async spawnDetached(command, args) {
      detached.push([command, ...args].join(" "));
      return 4242;
    },
  };
}
