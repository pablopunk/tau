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

function UseOtherNodes({ onUse }: { onUse: () => void }) {
  return (
    <section aria-label="Use other nodes" className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-sm text-muted-foreground">
        This node is linked to other nodes. Skip setup here and work on their threads; you can set this node
        up later from Settings → Nodes.
      </p>
      <Button type="button" variant="outline" onClick={onUse}>
        Use my other nodes
      </Button>
    </section>
  );
}

/**
 * `onUseOtherNodes` is given by the gate in `app/App.tsx` only when a peer is known (online or not): it sets
 * `Settings.setupSkipped`, and the action below renders only then.
 */
export interface SetupScreenProps {
  readonly keyConfigured: boolean;
  readonly onUseOtherNodes?: (() => void) | undefined;
}

export function SetupScreen({ keyConfigured, onUseOtherNodes }: SetupScreenProps) {
  const [continued, setContinued] = useState(false);
  const onModelStep = continued && keyConfigured;
  return (
    <main className="flex h-dvh overflow-y-auto bg-background p-4">
      <div className="m-auto flex w-full max-w-2xl flex-col gap-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
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
        {onUseOtherNodes ? <UseOtherNodes onUse={onUseOtherNodes} /> : null}
        {onModelStep ? (
          <ModelStep>
            <ProjectsFolderField />
          </ModelStep>
        ) : (
          <ConnectStep connected={keyConfigured} onContinue={() => setContinued(true)} />
        )}
        {onModelStep ? (
          <Button type="button" variant="ghost" onClick={() => setContinued(false)}>
            Back to providers
          </Button>
        ) : null}
      </div>
    </main>
  );
}
