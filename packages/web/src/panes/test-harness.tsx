import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore, type FakeCore } from "@tau/testkit";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useMatch, useParams } from "react-router";
import { LiveClientProvider } from "@/conversation/live-client-context";
import { createStubLiveClient } from "@/conversation/test-utils";
import { createFakeTransport } from "@/lib/transport/fake";
import type { Transport } from "@/lib/transport/types";
import { ThreadPanes } from "./ThreadPanes";

export interface Backend {
  core: FakeCore;
  transport: Transport;
}

export function createBackend(options: { terminals?: boolean } = {}): Backend {
  const core = createFakeCore({ ...options, configured: true });
  return { core, transport: createFakeTransport(core) };
}

export async function startThread(core: FakeCore): Promise<string> {
  await core.providers.setApiKey("openrouter", "fake");
  const summary = await core.conversations.start({ projectId: "home", text: "hello" } as never);
  return summary.id;
}

function Route_() {
  const { projectId = "", conversationId = "" } = useParams();
  const terminalId = useMatch("/p/:projectId/c/:conversationId/terminal/:terminalId")?.params.terminalId;
  return (
    <ThreadPanes projectId={projectId} conversationId={conversationId} terminalId={terminalId}>
      <div data-testid="conversation" className="flex h-full flex-col">
        <div data-testid="scroll" className="min-h-0 flex-1 overflow-y-auto" />
        <textarea aria-label="Message" />
      </div>
    </ThreadPanes>
  );
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

export function renderPanes(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <LiveClientProvider client={createStubLiveClient(null)}>
          <Where />
          <Routes>
            <Route path="/p/:projectId/c/:conversationId/*" element={<Route_ />} />
          </Routes>
        </LiveClientProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
