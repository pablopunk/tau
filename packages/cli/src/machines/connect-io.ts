import { createInterface } from "node:readline/promises";
import { usageError } from "../commands/cli-exit";

export type AfterLink = "serve" | "service" | "none";

/** The two questions `tau connect` may ask, replaceable in tests. */
export interface ConnectIo {
  confirm(question: string): Promise<boolean>;
  chooseStart(): Promise<AfterLink>;
}

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw usageError("This needs a terminal. Add --yes to skip the question.");
  const lines = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await lines.question(question)).trim().toLowerCase();
  } finally {
    lines.close();
  }
}

export const terminalIo: ConnectIo = {
  confirm: async (question) => ["y", "yes"].includes(await ask(`${question} [y/N] `)),
  async chooseStart() {
    const answer = await ask(
      "tau is not running here. Start it for this session (s), install it as a service (i), or neither (n)? [s/i/N] ",
    );
    return answer === "s" ? "serve" : answer === "i" ? "service" : "none";
  },
};
