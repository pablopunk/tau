import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeFolderSuggestion } from "@/github/CodeFolderSuggestion";
import { ProvidersSection } from "@/settings/ProvidersSection";
import { ModelStep } from "./ModelStep";

function ConnectStep({ connected, onContinue }: { connected: boolean; onContinue: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <ProvidersSection />
      <Button disabled={!connected} onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}

export function SetupScreen({ keyConfigured }: { keyConfigured: boolean }) {
  const [continued, setContinued] = useState(keyConfigured);
  const onModelStep = continued && keyConfigured;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Welcome to tau</h1>
          <p className="text-sm text-muted-foreground">
            {onModelStep
              ? "Step 2 of 2. Pick the model new conversations start with."
              : "Step 1 of 2. Connect a provider. Keys stay on this computer."}
          </p>
        </header>
        {onModelStep ? (
          <ModelStep />
        ) : (
          <ConnectStep connected={keyConfigured} onContinue={() => setContinued(true)} />
        )}
        {onModelStep ? <CodeFolderSuggestion /> : null}
      </div>
    </main>
  );
}
