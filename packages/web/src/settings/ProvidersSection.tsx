import type { ProviderInfo } from "@tau/protocol";
import { FormError } from "@/app/FormError";
import { ProviderList } from "@/components/ui/provider-list";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { useProviders } from "@/lib/queries";
import { AnthropicRow } from "./AnthropicRow";
import { ProviderRow } from "./ProviderRow";

const findById = (providers: ProviderInfo[], id: string) => providers.find((provider) => provider.id === id);

function ProviderRows({ providers }: { providers: ProviderInfo[] }) {
  const claudeCli = findById(providers, "claude-cli");
  const mergeable = findById(providers, "anthropic") && claudeCli?.cli;
  return providers.map((provider) => {
    if (mergeable && provider.id === "claude-cli") return null;
    if (mergeable && provider.id === "anthropic" && claudeCli)
      return <AnthropicRow key={provider.id} api={provider} cliProvider={claudeCli} />;
    return <ProviderRow key={provider.id} provider={provider} />;
  });
}

export function ProvidersSection() {
  const providers = useProviders();
  if (providers.isError) return <FormError message={errorMessage(providers.error)} />;
  if (providers.isPending) return <Skeleton className="h-9 w-full" />;
  return (
    <ProviderList aria-label="Providers">
      <ProviderRows providers={providers.data} />
    </ProviderList>
  );
}
