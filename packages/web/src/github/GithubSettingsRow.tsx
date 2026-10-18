import type { GithubStatus } from "@tau/protocol";
import { FormError } from "@/app/FormError";
import { SettingRow } from "@/components/ui/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { useGithubStatus } from "@/lib/queries";
import { statusHint } from "./repo-options";

const HEADINGS: Record<GithubStatus["state"], string> = {
  connected: "Connected",
  not_installed: "Not installed",
  not_logged_in: "Not logged in",
  error: "Error",
};

const detail = (status: GithubStatus): string =>
  status.state === "connected"
    ? `Connected as ${status.login}. Token from ${status.tokenSource}, git over ${status.gitProtocol}.`
    : (statusHint(status) ?? "");

export function GithubSettingsRow() {
  const status = useGithubStatus();
  if (status.isError) return <FormError message={errorMessage(status.error)} />;
  if (!status.data) return <Skeleton className="h-9 w-full" />;
  return (
    <SettingRow id="github-status" className="flex flex-col gap-1">
      <p className="text-sm font-medium">GitHub: {HEADINGS[status.data.state]}</p>
      <p className="text-sm text-muted-foreground">{detail(status.data)}</p>
    </SettingRow>
  );
}
