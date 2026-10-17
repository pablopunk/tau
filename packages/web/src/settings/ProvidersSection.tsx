import type { ProviderInfo } from "@pi-everywhere/protocol";
import { FormError } from "@/app/FormError";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { useProviders } from "@/lib/queries";

function connectionLabel(provider: ProviderInfo): string {
  const { connection } = provider;
  if (!connection) return "Not connected";
  if (connection.source === "env") return "From environment";
  if (connection.valid === false) return "Invalid key";
  if (connection.valid === null) return "Key not checked";
  return connection.method === "chatgpt" ? "Connected · ChatGPT" : "Connected · key";
}

function ProviderRow({ provider }: { provider: ProviderInfo }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{provider.name}</span>
      <Badge variant={provider.connection ? "default" : "secondary"}>{connectionLabel(provider)}</Badge>
    </li>
  );
}

export function ProvidersSection() {
  const providers = useProviders();
  if (providers.isError) return <FormError message={errorMessage(providers.error)} />;
  if (providers.isPending) return <Skeleton className="h-9 w-full" />;
  return (
    <ul className="flex flex-col gap-3" aria-label="Providers">
      {providers.data.map((provider) => (
        <ProviderRow key={provider.id} provider={provider} />
      ))}
    </ul>
  );
}
