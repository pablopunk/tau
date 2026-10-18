import { useState } from "react";
import { BrandText } from "@/components/ui/brand-text";
import { Button } from "@/components/ui/button";
import { ProjectsFolderField } from "@/settings/ProjectsFolderField";
import { ProvidersSection } from "@/settings/ProvidersSection";
import { ModelStep } from "./ModelStep";

function ConnectStep({ connected, onContinue }: { connected: boolean; onContinue: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Models come from providers. We found the connections below on this computer, including any API keys
        and Claude CLI login.
      </p>
      <ProvidersSection />
      <p className="text-sm text-muted-foreground">
        {connected
          ? "You’re connected. Continue to choose your models."
          : "Connect at least one provider to continue. Keys stay on this computer."}
      </p>
      <Button disabled={!connected} onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}

export function SetupScreen({ keyConfigured }: { keyConfigured: boolean }) {
  const [continued, setContinued] = useState(false);
  const onModelStep = continued && keyConfigured;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-2xl flex-col gap-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to <BrandText>tau</BrandText>
          </h1>
          <p className="text-sm text-muted-foreground">
            {onModelStep
              ? "Step 2 of 2. Choose your models and projects folder."
              : "Step 1 of 2. Review your providers."}
          </p>
        </header>
        {onModelStep ? (
          <ModelStep />
        ) : (
          <ConnectStep connected={keyConfigured} onContinue={() => setContinued(true)} />
        )}
        {onModelStep ? (
          <>
            <ProjectsFolderField />
            <Button type="button" variant="ghost" onClick={() => setContinued(false)}>
              Back to providers
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}
