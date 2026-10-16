import { Route, Routes, useParams } from "react-router";
import { MarkSeenWhileOpen } from "@/activity";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Conversation } from "@/conversation";
import { NotificationWatcher } from "@/notifications";
import { CommandPalette, GlobalShortcuts } from "@/palette";
import { AppSidebar } from "@/sidebar/AppSidebar";
import { NewThreadPage } from "./NewThreadPage";

function ConversationRoute() {
  const { conversationId } = useParams();
  if (!conversationId) return <NewThreadPage />;
  return <Conversation key={conversationId} id={conversationId} />;
}

export function MainLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <CommandPalette />
      <GlobalShortcuts />
      <NotificationWatcher />
      <MarkSeenWhileOpen />
      <SidebarInset className="h-dvh min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <SidebarTrigger aria-label="Open sidebar" />
          <span className="text-sm font-semibold">pi-everywhere</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Routes>
            <Route path="/p/:projectId/c/:conversationId" element={<ConversationRoute />} />
            <Route path="/new" element={<NewThreadPage />} />
            <Route path="*" element={<NewThreadPage />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
