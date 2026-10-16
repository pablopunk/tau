import { type FormEvent, useId, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface NameDialogProps {
  title: string;
  label: string;
  initialValue: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}

/** Rename dialog; mount it only while open so its state resets each time. */
export function NameDialog({ title, label, initialValue, onSubmit, onClose }: NameDialogProps) {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const { run, error, pending } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => onSubmit(value.trim()))) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">{label}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <Input id={id} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
            <FormError message={error} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || value.trim() === ""}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
