import { AppError } from "@tau/protocol";

export const notImplemented = (what: string) => new AppError("internal", `Not implemented: ${what}`);
