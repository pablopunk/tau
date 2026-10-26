import { useEffect, useState } from "react";

/** A section starts collapsed when empty and opens itself when content arrives. Manual toggles stick. */
export function useAutoExpand(hasContent: boolean) {
  const [open, setOpen] = useState(hasContent);
  useEffect(() => {
    if (hasContent) setOpen(true);
  }, [hasContent]);
  return { open, onOpenChange: setOpen };
}
