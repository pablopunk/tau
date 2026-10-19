import { BrowserRouter } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { isConnected } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useProviders, useSetSetupSkipped, useSettings } from "@/lib/queries";
import { useNodes } from "@/nodes";
import { MainLayout } from "@/routes/MainLayout";
import { SetupScreen } from "@/setup/SetupScreen";
import { Providers } from "./providers";
import { SettingsDialogProvider } from "./settings-dialog";
import { canUseOtherNodes, needsSetup } from "./setup-gate";

function Gate() {
  const providers = useProviders();
  const settings = useSettings();
  const { nodes, isLoading: nodesLoading } = useNodes();
  const skipSetup = useSetSetupSkipped();

  const failure = providers.error ?? settings.error;
  if (failure) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(failure)}
        </p>
      </main>
    );
  }
  if (!providers.data || !settings.data || (settings.data.setupSkipped && nodesLoading)) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }
  const connected = providers.data.some(isConnected);
  const canRunThreads = connected && settings.data.defaultModel !== null;
  if (needsSetup({ canRunThreads, setupSkipped: settings.data.setupSkipped, knownPeers: nodes.length })) {
    return (
      <SetupScreen
        keyConfigured={connected}
        onUseOtherNodes={canUseOtherNodes(nodes.length) ? () => skipSetup.mutate(true) : undefined}
      />
    );
  }
  return (
    <SettingsDialogProvider>
      <MainLayout />
    </SettingsDialogProvider>
  );
}

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </Providers>
  );
}
