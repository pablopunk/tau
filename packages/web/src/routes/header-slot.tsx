import { createContext, type ReactNode, useContext, useState } from "react";

interface HeaderSlot {
  readonly element: HTMLElement | null;
  readonly setElement: (element: HTMLElement | null) => void;
  readonly startingThread: boolean;
  readonly setStartingThread: (starting: boolean) => void;
}

const HeaderSlotContext = createContext<HeaderSlot>({
  element: null,
  setElement: () => undefined,
  startingThread: false,
  setStartingThread: () => undefined,
});

export function HeaderSlotProvider({ children }: { readonly children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [startingThread, setStartingThread] = useState(false);
  return (
    <HeaderSlotContext.Provider value={{ element, setElement, startingThread, setStartingThread }}>
      {children}
    </HeaderSlotContext.Provider>
  );
}

/** The right side of the top bar, or null while the top bar is hidden. */
export function useHeaderSlot(): HTMLElement | null {
  return useContext(HeaderSlotContext).element;
}

export function useStartingThreadHeader() {
  const { startingThread, setStartingThread } = useContext(HeaderSlotContext);
  return { startingThread, setStartingThread };
}

/** Where pages put content on the right side of the top bar. */
export function HeaderSlotOutlet() {
  const { setElement } = useContext(HeaderSlotContext);
  return <div ref={setElement} className="ml-auto flex min-w-0 items-center gap-2" />;
}
