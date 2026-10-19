import type { Machine } from "@tau/protocol";
import { FoldersIcon, ListIcon, MessageSquarePlusIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { useOpenSettings } from "@/app/settings-dialog";
import { Button } from "@/components/ui/button";
import { NodeName } from "@/components/ui/node-name";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TauLogo } from "@/components/ui/tau-logo";
import { newThreadPath } from "@/lib/paths";
import type { SidebarMode } from "@/lib/preferences";
import { MachineProvider, useMachines } from "@/machines";
import { isUsable } from "@/machines/machine-text";
import { useHubName } from "@/machines/use-machine-avatar";
import { MachineGroup } from "./MachineGroup";
import { MachineSection } from "./MachineSection";
import { OfflineMachineSection } from "./OfflineMachineSection";
import { useSidebarMode } from "./use-sidebar-preferences";

const MODE_OPTIONS = [
  { value: "threads", label: "Threads", icon: <ListIcon /> },
  { value: "projects", label: "Projects", icon: <FoldersIcon /> },
] as const satisfies readonly { value: SidebarMode; label: string; icon: React.ReactNode }[];

const sameMachine = (open: string | undefined, machineId: string | undefined) => open === machineId;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function RemoteGroup({ machine, mode }: { machine: Machine; mode: SidebarMode }) {
  const open = useOpenConversation();
  const navigate = useNavigate();
  const now = useNow();
  const active = sameMachine(open.machineId, machine.id);
  return (
    <MachineGroup machine={machine} name={machine.name}>
      {isUsable(machine) ? (
        <MachineProvider machineId={machine.id}>
          <MachineSection
            mode={mode}
            activeConversationId={active ? open.conversationId : undefined}
            onProjectRemoved={(removedId) => active && removedId === open.projectId && navigate("/")}
          />
        </MachineProvider>
      ) : (
        <OfflineMachineSection machine={machine} now={now} />
      )}
    </MachineGroup>
  );
}

function MachineSections({ mode }: { mode: SidebarMode }) {
  const { machines } = useMachines();
  const hubName = useHubName();
  const open = useOpenConversation();
  const navigate = useNavigate();
  const local = (
    <MachineSection
      mode={mode}
      activeConversationId={sameMachine(open.machineId, undefined) ? open.conversationId : undefined}
      onProjectRemoved={(removedId) =>
        open.machineId === undefined && removedId === open.projectId && navigate("/")
      }
    />
  );
  if (machines.length === 0) return local;
  return (
    <>
      <MachineGroup machine={undefined} name={hubName} local>
        {local}
      </MachineGroup>
      {machines.map((machine) => (
        <RemoteGroup key={machine.id} machine={machine} mode={mode} />
      ))}
    </>
  );
}

export function AppSidebar() {
  const [mode, setMode] = useSidebarMode();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  return (
    <Sidebar aria-label="Projects and threads">
      <SidebarHeader className="gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <TauLogo />
          <SidebarTrigger className="hidden shrink-0 md:inline-flex" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" className="min-w-0" onClick={() => navigate(newThreadPath())}>
            <MessageSquarePlusIcon />
            <span className="truncate">New thread</span>
          </Button>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={MODE_OPTIONS}
            aria-label="Sidebar view"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <MachineSections mode={mode} />
      </SidebarContent>
      <SidebarFooter>
        <Button variant="ghost" className="justify-start" onClick={openSettings}>
          <SettingsIcon />
          Settings
        </Button>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
