import { viewToText } from "@tau/protocol";
import { failure } from "./cli-exit";
import type { Server } from "./client";
import type { CommandEnv } from "./command-env";
import { connectLive } from "./live";

const READ_TIMEOUT_MS = 10_000;

/** The first view frame of a thread, as text. `last` keeps the final N messages. */
export function readThread(
  server: Server,
  env: CommandEnv,
  conversationId: string,
  last?: number,
): Promise<string> {
  const live = connectLive(server, env);
  live.subscribe(conversationId);
  return new Promise<string>((resolve, reject) => {
    const cancel = env.after(READ_TIMEOUT_MS, () =>
      end(() => reject(failure("Timed out reading the thread."))),
    );
    const end = (settle: () => void) => {
      cancel();
      live.close();
      settle();
    };
    live.onClose(() => end(() => reject(failure("Lost the connection to tau."))));
    live.onFrame(() => {
      const view = live.view(conversationId);
      if (view === undefined) return;
      if (view === null)
        return end(() => reject(failure(`not_found: Unknown conversation: ${conversationId}`)));
      end(() => resolve(viewToText(view, { last })));
    });
  });
}
