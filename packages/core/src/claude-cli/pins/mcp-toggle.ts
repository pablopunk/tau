import type { ClaudeMcpControl } from "../sdk-types";

/** Only the real-CLI pins switch servers; tau itself never does (the toggle outlives its query). */
export interface ClaudeMcpToggle {
  toggleMcpServer(name: string, enabled: boolean): Promise<void>;
}

export function togglerOf(control: ClaudeMcpControl): ClaudeMcpToggle {
  const toggle = (control as Partial<ClaudeMcpToggle>).toggleMcpServer;
  if (!toggle) throw new Error("This SDK port was loaded without exposeToggleForPins.");
  return { toggleMcpServer: (name, enabled) => toggle.call(control, name, enabled) };
}
