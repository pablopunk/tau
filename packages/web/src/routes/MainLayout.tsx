import { Route, Routes, useParams } from "react-router";
import { MarkSeenWhileOpen } from "@/activity";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Conversation } from "@/conversation";
import { preferences } from "@/lib/preferences";
import { NotificationWatcher } from "@/notifications";
import { CommandPalette, GlobalShortcuts } from "@/palette";
import { AppSidebar } from "@/sidebar/AppSidebar";
import { NewThreadPage } from "./NewThreadPage";

function ConversationRoute() {
  const { conversationId } = useParams();
  if (!conversationId) return <NewThreadPage />;
  return <Conversation key={conversationId} id={conversationId} />;
  // Seam for thread panes (owner C): read `terminalId` from a nested `<Routes><Route path="terminal/:terminalId" /></Routes>`
  // and render `<ThreadPanes>` around the Conversation. The Conversation keeps its key so it never remounts.
}

function MainHeader() {
  const { isMobile, open } = useSidebar();
  if (!isMobile && open) return null;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger aria-label="Open sidebar" />
      <span className="text-sm font-semibold">tau</span>
    </header>
  );
}

export function MainLayout() {
  return (
    <SidebarProvider
      defaultOpen={preferences.getSidebarOpen()}
      onOpenChange={preferences.setSidebarOpen}
      defaultWidth={preferences.getSidebarWidth()}
      onWidthChange={preferences.setSidebarWidth}
    >
      <AppSidebar />
      <CommandPalette />
      <GlobalShortcuts />
      <NotificationWatcher />
      <MarkSeenWhileOpen />
      <SidebarInset className="h-dvh min-w-0">
        <MainHeader />
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Routes>
            <Route path="/p/:projectId/c/:conversationId/*" element={<ConversationRoute />} />
            <Route path="/new" element={<NewThreadPage />} />
            <Route path="*" element={<NewThreadPage />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
