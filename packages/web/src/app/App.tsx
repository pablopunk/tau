import { BrowserRouter } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { isConnected } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useProviders, useSettings } from "@/lib/queries";
import { MainLayout } from "@/routes/MainLayout";
import { SetupScreen } from "@/setup/SetupScreen";
import { Providers } from "./providers";
import { SettingsDialogProvider } from "./settings-dialog";

function Gate() {
  const providers = useProviders();
  const settings = useSettings();

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
  if (!providers.data || !settings.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }
  const connected = providers.data.some(isConnected);
  if (!connected || !settings.data.defaultModel) {
    return <SetupScreen keyConfigured={connected} />;
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
