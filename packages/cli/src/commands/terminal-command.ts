import { terminalStreamPath } from "@tau/protocol";
import { CliExit, usageError } from "./cli-exit";
import { callRoute, discoverServer } from "./client";
import type { CommandEnv } from "./command-env";
import { terminalInputFrame, terminalServerFrame } from "./machine-stream";
import { targetPath } from "./node-target";
import { scanArgs } from "./scan-args";

export async function runTerminalAttach(argv: readonly string[], env: CommandEnv): Promise<void> {
  const { positionals, flags } = scanArgs(argv, { cols: "value", rows: "value" });
  if (positionals.length !== 1)
    throw usageError("Usage: tau terminals attach <id> --machine [--cols N --rows N]");
  const machine = env.machine;
  if (!machine) throw new CliExit(1, "Terminal attach requires --machine", "unsupported");
  const id = positionals[0] as string;
  machine.identify({ terminalId: id });
  const resize = terminalInputFrame(
    JSON.stringify({
      type: "resize",
      cols: Number(flags.get("cols") ?? 80),
      rows: Number(flags.get("rows") ?? 24),
    }),
  );
  const server = await discoverServer(env);
  const available = (await callRoute(server, "getTerminalsAvailable", {}, env)) as { available: boolean };
  if (!available.available) throw new CliExit(1, "Terminals are unavailable on this node", "unsupported");
  const url = `${server.url.replace(/^http/, "ws")}${targetPath(server, terminalStreamPath(id))}`;
  const socket = env.openSocket(url, { authorization: `Bearer ${server.token}` });
  await new Promise<void>((resolve, reject) => {
    let done = false;
    let ready = false;
    let sequence = 0;
    let pending: Promise<void> = Promise.resolve();
    const cleanup: (() => void)[] = [];
    const finish = (error?: unknown, result?: string) => {
      if (done) return;
      done = true;
      for (const cancel of cleanup) cancel();
      socket.close();
      if (error) reject(error);
      else {
        machine.emit("terminal", { result: result ?? "exited", observation: "response" });
        resolve();
      }
    };
    socket.onmessage = ({ data }) => {
      pending = pending
        .then(async () => {
          if (done) return;
          const frame = await terminalServerFrame(data);
          if (!ready && frame.type !== "ready")
            throw new CliExit(1, "Terminal closed before ready", "connection_lost");
          if (ready && frame.type === "ready")
            throw new CliExit(1, "Repeated terminal ready frame", "connection_lost");
          machine.emit("event", { event: { stream: "terminal", sequence: sequence++, frame } });
          if (frame.type === "ready") {
            ready = true;
            socket.send(String(resize));
            if (env.terminalInput)
              cleanup.push(
                env.terminalInput(
                  (line) => {
                    try {
                      (socket.send as (data: string | Uint8Array) => void)(terminalInputFrame(line));
                    } catch (error) {
                      finish(error);
                    }
                  },
                  () => finish(undefined, "detached"),
                ),
              );
          }
          if (frame.type === "exit") {
            if (frame.exitCode !== 0) {
              const error = new CliExit(1, `Terminal exited with ${frame.exitCode ?? "unknown status"}`);
              machine.emit("terminal", { result: { exitCode: frame.exitCode }, observation: "response" });
              error.reported = true;
              finish(error);
            } else finish();
          }
        })
        .catch((error: unknown) => finish(error));
    };
    socket.onclose = () => {
      void pending.then(() =>
        finish(
          new CliExit(1, "Terminal connection lost before exit; process state is unknown", "connection_lost"),
        ),
      );
    };
    socket.onerror = () => finish(new CliExit(1, "Terminal connection failed", "connection_lost"));
    if (env.onInterrupt)
      cleanup.push(
        env.onInterrupt(() =>
          finish(new CliExit(130, "Detached; terminal was not killed", "wait_interrupted")),
        ),
      );
    cleanup.push(
      env.after(10_000, () => {
        if (!ready) finish(new CliExit(1, "Terminal did not become ready", "connection_lost"));
      }),
    );
  });
}
