import type { ProviderInfo } from "@tau/protocol";
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
import { useAcknowledgeClaudeCli, useRefreshClaudeCli } from "@/lib/queries";
import { ClaudeCliNotice } from "./ClaudeCliNotice";
import { claudeCliAction, claudeCliActionLabel, claudeCliBadge, claudeCliNote } from "./ClaudeCliText";

/** Owner C. Frozen props; `ProviderRow` hands every provider with a `cli` status to this row. */
export function ClaudeCliRow({ provider }: { provider: ProviderInfo }) {
  const acknowledge = useAcknowledgeClaudeCli();
  const refresh = useRefreshClaudeCli();
  const { run, error, pending } = useSubmit();
  const cli = provider.cli;
  if (!cli) return null;
  const badge = claudeCliBadge(cli);
  const action = claudeCliAction(cli);
  const perform = () =>
    run(async () => void (await (action === "acknowledge" ? acknowledge : refresh).mutateAsync()));
  return (
    <SettingRow id={`provider:${provider.id}`} asChild>
      <ProviderListRow aria-label={provider.name} className="rounded-none!">
        <ProviderListName name={provider.name} />
        <ProviderListStatus label={badge.label} note={claudeCliNote(cli)}>
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
            {claudeCliActionLabel(action)}
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
