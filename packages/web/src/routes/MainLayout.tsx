import { MessagesSquareIcon } from "lucide-react";
import { Route, Routes, useParams } from "react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Conversation } from "@/conversation";
import { AppSidebar } from "@/sidebar/AppSidebar";

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <MessagesSquareIcon className="size-10 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">No chat selected</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Pick a chat from the sidebar, or press the plus next to a project to start a new one.
      </p>
    </div>
  );
}

function ConversationRoute() {
  const { conversationId } = useParams();
  if (!conversationId) return <EmptyState />;
  return <Conversation key={conversationId} id={conversationId} />;
}

export function MainLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-dvh min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <SidebarTrigger aria-label="Open sidebar" />
          <span className="text-sm font-semibold">pi-everywhere</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Routes>
            <Route path="/p/:projectId/c/:conversationId" element={<ConversationRoute />} />
            <Route path="*" element={<EmptyState />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
