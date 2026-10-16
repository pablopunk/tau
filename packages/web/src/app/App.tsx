import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Conversation } from "@/conversation";
import { api } from "@/lib/api";
import { Providers } from "./providers";

function ProviderBadge() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["provider"],
    queryFn: () => api.provider.status(),
  });
  if (isPending) return <Badge variant="secondary">Checking provider…</Badge>;
  if (isError) return <Badge variant="destructive">Server unreachable</Badge>;
  return <Badge variant="secondary">{data.configured ? "Provider ready" : "Provider not set up"}</Badge>;
}

/** Phase 0 shell: workstream C replaces it with routing, setup, sidebar and dialogs. */
export function App() {
  return (
    <Providers>
      <div className="flex h-dvh flex-col">
        <header className="flex items-center gap-3 px-4 py-3">
          <h1 className="text-sm font-semibold">pi-everywhere</h1>
          <ProviderBadge />
        </header>
        <Separator />
        <main className="min-h-0 flex-1 overflow-auto">
          <Conversation id="shell" />
        </main>
      </div>
    </Providers>
  );
}
