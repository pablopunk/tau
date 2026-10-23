import { type ConversationView, executorOf, viewToText } from "@tau/protocol";
import { failure } from "./cli-exit";
import type { Server } from "./client";
import type { CommandEnv } from "./command-env";
import { connectLive } from "./live";
import { hasNativeEntries, nativeEntriesWithoutExecutorMessage, nativeViewToText } from "./native-text";
import { listAll } from "./wait";

const READ_TIMEOUT_MS = 10_000;

function textOf(view: ConversationView, conversationId: string, native: boolean, last?: number): string {
  if (native) return nativeViewToText(view, { last });
  if (hasNativeEntries(view)) {
    throw failure(nativeEntriesWithoutExecutorMessage(conversationId));
  }
  return viewToText(view, { last });
}

async function isNativeThread(server: Server, env: CommandEnv, conversationId: string): Promise<boolean> {
  const summary = (await listAll(server, env)).find((item) => item.id === conversationId);
  return executorOf(summary) !== "pi";
}

/** The first view frame of a thread, as text. `last` keeps the final N messages. */
export async function readThread(
  server: Server,
  env: CommandEnv,
  conversationId: string,
  last?: number,
): Promise<string> {
  const native = await isNativeThread(server, env, conversationId);
  return readFirstView(server, env, conversationId, (view) => textOf(view, conversationId, native, last));
}

function readFirstView(
  server: Server,
  env: CommandEnv,
  conversationId: string,
  render: (view: ConversationView) => string,
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
      try {
        const text = render(view);
        end(() => resolve(text));
      } catch (error) {
        end(() => reject(error));
      }
    });
  });
}
