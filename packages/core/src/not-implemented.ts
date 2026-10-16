import { AppError } from "@pi-everywhere/protocol";

export const notImplemented = (what: string) => new AppError("internal", `Not implemented: ${what}`);
