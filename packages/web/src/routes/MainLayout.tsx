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
import { HeaderSlotOutlet, HeaderSlotProvider, useStartingThreadHeader } from "./header-slot";
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
  const { startingThread } = useStartingThreadHeader();
  // On mobile thread pages the thread renders its own bar (toggle + title +
  // actions), so the app bar would be a second, redundant header.
  if (isMobile && (conversationId || startingThread)) return null;
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
 * Shrink the app to the visual viewport only while the keyboard is open.
 * `100dvh` ignores the iOS keyboard, so the composer would slide behind it.
 * With no keyboard the var is removed: a stale or toolbar-sized viewport
 * height would leave a blank band under the composer.
 */
const KEYBOARD_MIN_PX = 120;

function useVisualViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement.style;
    const update = () => {
      const keyboardOpen = window.innerHeight - viewport.height > KEYBOARD_MIN_PX;
      if (keyboardOpen) root.setProperty("--tau-app-height", `${viewport.height}px`);
      else root.removeProperty("--tau-app-height");
    };
    update();
    viewport.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      viewport.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      root.removeProperty("--tau-app-height");
    };
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
