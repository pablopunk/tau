import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NotificationSettings } from "@/notifications";
import { KeyForm } from "./KeyForm";
import { ProjectsFolderField } from "./ProjectsFolderField";
import { SettingsModels } from "./SettingsModels";

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
          <DialogDescription>Models, projects folder, notifications and provider key.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <SettingsModels />
          <ProjectsFolderField />
          <NotificationSettings />
          <KeyForm replacing />
        </div>
      </DialogContent>
    </Dialog>
  );
}
