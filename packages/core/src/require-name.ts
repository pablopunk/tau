import { AppError } from "@tau/protocol";

export function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new AppError("invalid_request", "The name cannot be empty.");
  return trimmed;
}
