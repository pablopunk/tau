import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ASK_TO_COMMIT, askToResolve } from "./canned-messages";
import type { WorkspaceFailure } from "./use-workspace-actions";

interface WorkspaceErrorProps {
  failure: WorkspaceFailure;
  base: string;
  disabled: boolean;
  onSend(text: string): void;
  onDismiss(): void;
}

function cannedAction(code: string | null, base: string) {
  if (code === "worktree_dirty") return { label: "Ask agent to commit", text: ASK_TO_COMMIT };
  if (code === "merge_conflict") return { label: "Ask agent to resolve", text: askToResolve(base) };
  return null;
}

export function WorkspaceError({ failure, base, disabled, onSend, onDismiss }: WorkspaceErrorProps) {
  const action = cannedAction(failure.code, base);
  return (
    <Alert variant="destructive" className="flex w-auto items-center gap-2 py-1">
      <AlertDescription className="text-destructive">{failure.message}</AlertDescription>
      {action && (
        <Button size="xs" disabled={disabled} onClick={() => onSend(action.text)}>
          {action.label}
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </Alert>
  );
}
