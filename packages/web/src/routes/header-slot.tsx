import { createContext, type ReactNode, useContext, useState } from "react";

interface HeaderSlot {
  readonly element: HTMLElement | null;
  readonly setElement: (element: HTMLElement | null) => void;
}

const HeaderSlotContext = createContext<HeaderSlot>({ element: null, setElement: () => undefined });

export function HeaderSlotProvider({ children }: { readonly children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  return <HeaderSlotContext.Provider value={{ element, setElement }}>{children}</HeaderSlotContext.Provider>;
}

/** The right side of the top bar, or null while the top bar is hidden. */
export function useHeaderSlot(): HTMLElement | null {
  return useContext(HeaderSlotContext).element;
}

/** Where pages put content on the right side of the top bar. */
export function HeaderSlotOutlet() {
  const { setElement } = useContext(HeaderSlotContext);
  return <div ref={setElement} className="ml-auto flex min-w-0 items-center gap-2" />;
}
