import { createContext, type ReactNode, useContext, useState } from "react";
import { SettingsDialog } from "@/setup/SettingsDialog";

export const SettingsDialogContext = createContext<() => void>(() => {});

export const useOpenSettings = () => useContext(SettingsDialogContext);

export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsDialogContext.Provider value={() => setOpen(true)}>
      {children}
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </SettingsDialogContext.Provider>
  );
}
