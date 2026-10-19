import { Route, Routes, useSearchParams } from "react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { preferences } from "@/lib/preferences";
import { useMachines } from "@/machines";
import { MachineScope } from "@/machines/MachineScope";
import { isUsable } from "@/machines/machine-text";
import { NotificationWatcher } from "@/notifications";
import { CommandPalette, GlobalShortcuts } from "@/palette";
import { AppSidebar } from "@/sidebar/AppSidebar";
import { ConversationRoute } from "./ConversationRoute";
import { NewThreadPage } from "./NewThreadPage";

function NewThreadRoute() {
  const machineId = useSearchParams()[0].get("machine") ?? undefined;
  const { machines } = useMachines();
  const usable = machines.some((machine) => machine.id === machineId && isUsable(machine));
  return (
    <MachineScope machineId={usable ? machineId : undefined}>
      <NewThreadPage />
    </MachineScope>
  );
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
      <SidebarInset className="h-dvh min-w-0">
        <MainHeader />
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Routes>
            <Route path="/p/:projectId/c/:conversationId/*" element={<ConversationRoute />} />
            <Route path="/m/:machineId/p/:projectId/c/:conversationId/*" element={<ConversationRoute />} />
            <Route path="/new" element={<NewThreadRoute />} />
            <Route path="*" element={<NewThreadRoute />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
