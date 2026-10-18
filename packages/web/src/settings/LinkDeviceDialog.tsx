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
import { countdown, FULL_POWER_NOTE } from "./RemoteText";
import { usePairing } from "./use-pairing";

type PairingState = ReturnType<typeof usePairing>;

function LinkedMessage({ name }: { name: string }) {
  return (
    <p role="status" className="py-6 text-center text-sm font-medium">
      Linked: {name}
    </p>
  );
}

function PairingCode({ state }: { state: PairingState }) {
  const { pairing, expired, msLeft } = state;
  if (!pairing) return <Spinner className="mx-auto my-12" />;
  return (
    <div className="flex flex-col items-center gap-4" data-expired={expired || undefined}>
      {pairing.link ? (
        <QrCode
          value={pairing.link}
          label="QR code of the link"
          className={expired ? "opacity-30" : undefined}
        />
      ) : null}
      <CodeDisplay code={pairing.shortCode} />
      {pairing.link ? (
        <div className="flex w-full min-w-0 items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs">
            {pairing.link}
          </code>
          <CopyButton text={pairing.link} label="Copy link" />
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {expired ? "This code expired." : `Waiting for the device… Expires in ${countdown(msLeft)}`}
      </p>
    </div>
  );
}

export function LinkDeviceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const state = usePairing(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Link a device</DialogTitle>
          <DialogDescription>
            Scan the code with the phone camera, open the link, or type the code on the pair page.
          </DialogDescription>
        </DialogHeader>
        {state.linked ? <LinkedMessage name={state.linked.name} /> : <PairingCode state={state} />}
        <FormError message={state.error} />
        <p className="text-sm text-muted-foreground">{FULL_POWER_NOTE}</p>
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
