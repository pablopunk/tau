/** Copy of bare `tau`. `<...>` pieces are filled by the caller. */
export const installingService = (backend: "launchd" | "systemd" | string) =>
  `Installing the tau service (${backend})...`;
export const SERVICE_RUNNING = "tau is running as a service. It starts at login and restarts if it crashes.";
export const alreadyRunning = (version: string) => `tau ${version} is already running as a service.`;
export const REPAIRING = "Repairing the tau service...";
export const openLine = (url: string) => `Open: ${url}`;
export const PAIR_LINE = "To use tau from your phone or another device, run: tau pair";
export const NO_SERVICE_MANAGER =
  "No service manager here. tau runs in the background and will not survive a reboot or logout.";
export const LINGER_HINT =
  "To start it at boot: enable a systemd user session (loginctl enable-linger $USER), then run tau again.";
export const serviceInstallFailed = (reason: string) =>
  `Could not install the tau service: ${reason}. Run: tau service install`;
export const DID_NOT_START = "tau did not start. Run `tau logs`.";
export const WAITING_TO_START = "Waiting for tau to start...";
export const WAITING_TO_STOP = "Waiting for tau to stop (it is closing its threads)...";
export const foregroundHolder = (pid: number) =>
  `tau is already running in a terminal (pid ${pid}). Stop it (Ctrl+C), then run tau again.`;
