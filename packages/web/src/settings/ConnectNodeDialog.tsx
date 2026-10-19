import { FormError } from "@/app/FormError";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QrCode } from "@/components/ui/qr-code";
import { Spinner } from "@/components/ui/spinner";
import { CONNECT_POWER_NOTE } from "@/nodes/node-text";
import { countdown } from "./RemoteText";
import { hubUrlOf, useNodePairing } from "./use-node-pairing";

type PairingState = ReturnType<typeof useNodePairing>;

function CommandLine({ command, label }: { command: string; label: string }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs" title={command}>
        {command}
      </code>
      <CopyButton text={command} label={label} />
    </div>
  );
}

function NodeCode({ state }: { state: PairingState }) {
  const { pairing, expired, msLeft } = state;
  if (!pairing) return <Spinner className="mx-auto my-12" />;
  const link = pairing.link;
  return (
    <div className="flex flex-col items-center gap-4" data-expired={expired || undefined}>
      {link ? (
        <QrCode value={link} label="QR code of the link" className={expired ? "opacity-30" : undefined} />
      ) : null}
      <CodeDisplay code={pairing.shortCode} />
      <div className="flex w-full min-w-0 flex-col gap-2 text-sm">
        <p className="text-muted-foreground">On the other node, run:</p>
        {link ? (
          <CommandLine command={`npx @pablopunk/tau connect ${link}`} label="Copy command with link" />
        ) : null}
        <CommandLine
          command={`tau connect ${pairing.shortCode} --hub ${hubUrlOf(pairing)}`}
          label="Copy command with short code"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {expired ? "This code expired." : `Waiting for the node… Expires in ${countdown(msLeft)}`}
      </p>
    </div>
  );
}

export function ConnectNodeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const state = useNodePairing(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a node</DialogTitle>
          <DialogDescription>
            Run one command on the other computer. It links itself to this tau and shows up in the sidebar.
          </DialogDescription>
        </DialogHeader>
        {state.linked ? (
          <p role="status" className="py-6 text-center text-sm font-medium">
            Connected: {state.linked.name}
          </p>
        ) : (
          <NodeCode state={state} />
        )}
        <FormError message={state.error} />
        <p className="text-sm text-muted-foreground">{CONNECT_POWER_NOTE}</p>
        <DialogFooter>
          {state.linked ? null : (
            <Button variant="outline" onClick={() => void state.create()}>
              New code
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>{state.linked ? "Done" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
