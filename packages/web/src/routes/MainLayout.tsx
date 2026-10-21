import { useEffect } from "react";
import { Route, Routes, useSearchParams } from "react-router";
import { useOpenConversation } from "@/activity";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { preferences } from "@/lib/preferences";
import { useNodes } from "@/nodes";
import { NodeScope } from "@/nodes/NodeScope";
import { isUsable } from "@/nodes/node-text";
import { useDefaultTarget } from "@/nodes/use-default-target";
import { useNodeIdReconcile } from "@/nodes/use-node-id-reconcile";
import { NotificationWatcher } from "@/notifications";
import { CommandPalette, GlobalShortcuts } from "@/palette";
import { AppSidebar } from "@/sidebar/AppSidebar";
import { ConversationRoute } from "./ConversationRoute";
import { HeaderSlotOutlet, HeaderSlotProvider } from "./header-slot";
import { LegacyNodeRedirect } from "./LegacyNodeRedirect";
import { NewThreadPage, NewThreadSkeleton } from "./NewThreadPage";

function NewThreadRoute() {
  const asked = useSearchParams()[0].get("node") ?? undefined;
  const { nodes } = useNodes();
  const fallback = useDefaultTarget();
  if (asked === undefined && !fallback.ready) return <NewThreadSkeleton />;
  const nodeId = asked ?? fallback.nodeId;
  const usable = nodes.some((node) => node.id === nodeId && isUsable(node));
  return (
    <NodeScope nodeId={usable ? nodeId : undefined}>
      <NewThreadPage />
    </NodeScope>
  );
}

function MainHeader() {
  const { isMobile, open } = useSidebar();
  const { conversationId } = useOpenConversation();
  // On mobile thread pages the thread renders its own bar (toggle + title +
  // actions), so the app bar would be a second, redundant header.
  if (isMobile && conversationId) return null;
  if (!isMobile && open) return null;
  return (
    // pt-[env()]: in a fullscreen PWA the status bar overlays the web view;
    // without this the toggle slides under the notch and can't be tapped.
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 pt-[env(safe-area-inset-top)]">
      <SidebarTrigger aria-label="Open sidebar" />
      <span className="text-sm font-semibold">tau</span>
      <HeaderSlotOutlet />
    </header>
  );
}

/**
 * Track the visual viewport height in a CSS var. `100dvh` ignores the iOS
 * keyboard (it sizes to the large viewport), so without this the composer
 * slides behind the keyboard with no way to see what you type. Browsers
 * without visualViewport keep the `100dvh` fallback.
 */
function useVisualViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      document.documentElement.style.setProperty("--tau-app-height", `${viewport.height}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
}

export function MainLayout() {
  useNodeIdReconcile();
  useVisualViewportHeight();
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
      <SidebarInset className="h-[var(--tau-app-height,100dvh)] min-w-0">
        <HeaderSlotProvider>
          <MainHeader />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Routes>
              <Route path="/p/:projectId/c/:conversationId/*" element={<ConversationRoute />} />
              <Route path="/n/:nodeId/p/:projectId/c/:conversationId/*" element={<ConversationRoute />} />
              <Route path="/m/*" element={<LegacyNodeRedirect />} />
              <Route path="/new" element={<NewThreadRoute />} />
              <Route path="*" element={<NewThreadRoute />} />
            </Routes>
          </div>
        </HeaderSlotProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
