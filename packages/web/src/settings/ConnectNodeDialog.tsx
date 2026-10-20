import { FormError } from "@/app/FormError";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { CONNECT_POWER_DETAIL, CONNECT_POWER_TITLE } from "@/nodes/node-text";
import { countdown } from "./RemoteText";
import { useNodePairing } from "./use-node-pairing";

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

const INSTALL_COMMAND =
  "curl -fsSL https://github.com/pablopunk/tau/releases/latest/download/install.sh | sh";

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
        <p className="text-muted-foreground">Without tau on the other node, install it first:</p>
        <CommandLine command={INSTALL_COMMAND} label="Copy install command" />
        <p className="text-muted-foreground">Then run:</p>
        {link ? <CommandLine command={`tau connect '${link}'`} label="Copy command with link" /> : null}
        {link ? (
          <>
            <p className="text-muted-foreground">Or with the code:</p>
            <CommandLine
              command={`tau connect ${pairing.shortCode} --node '${new URL(link).origin}'`}
              label="Copy command with code"
            />
          </>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {expired ? "This code expired." : `Waiting for the node… Expires in ${countdown(msLeft)}`}
      </p>
    </div>
  );
}

/** `node` is the node the new one links to; absent: this node. */
export function ConnectNodeDialog({
  open,
  onOpenChange,
  node,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: { id: string; name: string } | undefined;
}) {
  const state = useNodePairing(open, node?.id);
  const target = node?.name ?? "this node";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a node</DialogTitle>
          <DialogDescription>
            Run one command on the other computer. It links itself to {target} and shows up in the sidebar.
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
        <Alert role="note">
          <AlertTitle>{CONNECT_POWER_TITLE}</AlertTitle>
          <AlertDescription>{CONNECT_POWER_DETAIL}</AlertDescription>
        </Alert>
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
