import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";

/** Runs an async palette action; a failure becomes a toast. */
export const attempt = (action: () => Promise<unknown>) => () =>
  void action().catch((error) => toast.error(errorMessage(error)));
