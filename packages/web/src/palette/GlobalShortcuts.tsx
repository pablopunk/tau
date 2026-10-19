import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { useHotkey } from "@/lib/hotkeys";
import { newThreadPath } from "@/lib/paths";

export function GlobalShortcuts() {
  const navigate = useNavigate();
  const { projectId, machineId } = useOpenConversation();
  useHotkey("mod+shift+o", () => navigate(newThreadPath(projectId, machineId)));
  return null;
}
