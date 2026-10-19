import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { useHotkey } from "@/lib/hotkeys";
import { newThreadPath } from "@/lib/paths";
import { useAdjacentThread } from "./adjacent-thread";

export function GlobalShortcuts() {
  const navigate = useNavigate();
  const { projectId, machineId } = useOpenConversation();
  const { go } = useAdjacentThread();
  useHotkey("mod+alt+arrowdown", () => go(1));
  useHotkey("mod+alt+arrowup", () => go(-1));
  useHotkey("mod+shift+o", () => navigate(newThreadPath(projectId, machineId)));
  return null;
}
