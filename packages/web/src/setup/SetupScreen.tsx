import { KeyForm } from "./KeyForm";
import { ModelStep } from "./ModelStep";

export function SetupScreen({ keyConfigured }: { keyConfigured: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Welcome to pi-everywhere</h1>
          <p className="text-sm text-muted-foreground">
            {keyConfigured
              ? "Step 2 of 2. Pick the model new conversations start with."
              : "Step 1 of 2. Paste your OpenRouter key. It stays on this computer."}
          </p>
        </header>
        {keyConfigured ? <ModelStep /> : <KeyForm />}
      </div>
    </main>
  );
}
