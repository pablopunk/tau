import type { OpenTerminalInput, TerminalInfo } from "@tau/protocol";
import { terminalStreamPath } from "@tau/protocol";
import { transport } from "@/lib/api";
import type { StreamHandlers, StreamSocket } from "@/lib/transport/types";

/** Terminals over the shared transport (REST plus the binary stream). */
export const terminalApi = {
  available: async (): Promise<boolean> => (await transport.request("getTerminalsAvailable", {})).available,
  list: (id: string): Promise<TerminalInfo[]> => transport.request("listTerminals", { params: { id } }),
  open: (id: string, size: OpenTerminalInput): Promise<TerminalInfo> =>
    transport.request("openTerminal", { params: { id }, body: size }),
  close: (id: string): Promise<void> => transport.request("closeTerminal", { params: { id } }),
  openStream: (id: string, handlers: StreamHandlers): StreamSocket =>
    transport.openStream(terminalStreamPath(id), handlers),
};
