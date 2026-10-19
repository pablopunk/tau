import * as React from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface TypedConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  /** What must be typed to enable the button. */
  phrase: string
  confirmLabel: string
  onConfirm: () => void
  error?: string | null
  busy?: boolean
}

/** A destructive question that stays disabled until the user types the exact phrase. */
function TypedConfirmDialog({ open, onOpenChange, title, description, phrase, confirmLabel, onConfirm, error, busy }: TypedConfirmDialogProps) {
  const [typed, setTyped] = React.useState("")
  const inputId = React.useId()
  React.useEffect(() => {
    if (!open) setTyped("")
  }, [open])
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>Type {phrase} to confirm</Label>
          <Input id={inputId} value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={typed !== phrase || busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { TypedConfirmDialog }
export type { TypedConfirmDialogProps }
