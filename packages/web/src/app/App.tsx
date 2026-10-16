import { BrowserRouter } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { useProvider, useSettings } from "@/lib/queries";
import { MainLayout } from "@/routes/MainLayout";
import { SetupScreen } from "@/setup/SetupScreen";
import { Providers } from "./providers";
import { SettingsDialogProvider } from "./settings-dialog";

function Gate() {
  const provider = useProvider();
  const settings = useSettings();

  const failure = provider.error ?? settings.error;
  if (failure) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(failure)}
        </p>
      </main>
    );
  }
  if (!provider.data || !settings.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }
  if (!provider.data.configured || !settings.data.defaultModel) {
    return <SetupScreen keyConfigured={provider.data.configured} />;
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
