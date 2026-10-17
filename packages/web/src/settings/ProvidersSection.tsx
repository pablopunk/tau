import { FormError } from "@/app/FormError";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { useProviders } from "@/lib/queries";
import { ProviderRow } from "./ProviderRow";

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
