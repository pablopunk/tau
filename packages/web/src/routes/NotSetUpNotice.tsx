import { useOpenSettings } from "@/app/settings-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Shown instead of a working composer while the node has no provider: where to fix it, on this node or another. */
export function NotSetUpNotice({ nodeId }: { nodeId: string | undefined }) {
  const openProviders = useOpenSettings(nodeId === undefined ? "providers" : "nodes");
  return (
    <Alert role="status" className="max-w-2xl">
      <AlertTitle>This node is not set up</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>
          It has no provider yet, so it cannot run threads. Set it up, or start a thread on a node that is set
          up.
        </span>
        <Button variant="outline" size="xs" onClick={openProviders}>
          Set up
        </Button>
      </AlertDescription>
    </Alert>
  );
}
