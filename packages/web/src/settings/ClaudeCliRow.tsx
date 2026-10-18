import type { ClaudeCliStatus, ProviderInfo } from "@tau/protocol";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ProviderListActions,
  ProviderListDetail,
  ProviderListName,
  ProviderListRow,
  ProviderListStatus,
} from "@/components/ui/provider-list";
import { SettingRow } from "@/components/ui/settings-layout";
import { useAcknowledgeClaudeCli, useInstallClaudeCliSdk, useRefreshClaudeCli } from "@/lib/queries";
import { ClaudeCliNotice } from "./ClaudeCliNotice";
import {
  claudeCliAction,
  claudeCliActionLabel,
  claudeCliBadge,
  claudeCliNote,
  claudeCliPendingLabel,
  isUsageWarning,
} from "./ClaudeCliText";

function ClaudeCliNote({ cli }: { cli: ClaudeCliStatus }) {
  const className = isUsageWarning(cli) ? "text-amber-600 dark:text-amber-400" : undefined;
  return <span className={className}>{claudeCliNote(cli)}</span>;
}

export function ClaudeCliRow({ provider }: { provider: ProviderInfo }) {
  const acknowledge = useAcknowledgeClaudeCli();
  const refresh = useRefreshClaudeCli();
  const install = useInstallClaudeCliSdk();
  const { run, error, pending } = useSubmit();
  const cli = provider.cli;
  if (!cli) return null;
  const badge = claudeCliBadge(cli);
  const action = claudeCliAction(cli);
  const mutations = { acknowledge, refresh, install };
  const perform = () => run(async () => void (await mutations[action].mutateAsync()));
  const pendingLabel = pending ? claudeCliPendingLabel(action) : null;
  return (
    <SettingRow id={`provider:${provider.id}`} asChild>
      <ProviderListRow aria-label={provider.name} className="rounded-none!">
        <ProviderListName name={provider.name} />
        <ProviderListStatus label={badge.label} note={<ClaudeCliNote cli={cli} />}>
          <Badge variant={badge.destructive ? "destructive" : "secondary"} className="min-w-0 justify-start">
            <span className="truncate">{badge.label}</span>
          </Badge>
        </ProviderListStatus>
        <ProviderListActions>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`${claudeCliActionLabel(action)} for ${provider.name}`}
            onClick={perform}
          >
            {pendingLabel ?? claudeCliActionLabel(action)}
          </Button>
        </ProviderListActions>
        {cli.state === "needs_notice" ? (
          <ProviderListDetail>
            <ClaudeCliNotice />
          </ProviderListDetail>
        ) : null}
        {error ? (
          <ProviderListDetail>
            <FormError message={error} />
          </ProviderListDetail>
        ) : null}
      </ProviderListRow>
    </SettingRow>
  );
}
