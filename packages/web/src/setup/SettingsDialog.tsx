import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyForm } from "./KeyForm";
import { ModelStep } from "./ModelStep";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Provider key and default model.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <ModelStep />
          <KeyForm replacing />
        </div>
      </DialogContent>
    </Dialog>
  );
}
