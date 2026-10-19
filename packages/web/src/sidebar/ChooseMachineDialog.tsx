import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MachineAvatar } from "@/components/ui/machine-avatar";
import type { MachineData } from "@/machines";

/** "Add project" with several machines asks first: whose disk is the folder on? */
export function ChooseMachineDialog({
  machines,
  onChoose,
  onClose,
}: {
  machines: readonly MachineData[];
  onChoose: (machineId: string | undefined) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Which machine?</DialogTitle>
          <DialogDescription>The project folder lives on one machine. Pick it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {machines.map((machine) => (
            <Button
              key={machine.machineId ?? "local"}
              variant="outline"
              className="justify-start"
              onClick={() => onChoose(machine.machineId)}
            >
              <MachineAvatar os={machine.os} status={machine.status} />
              {machine.name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
