import { AppError } from "@tau/protocol";

const MAX_NAME_LENGTH = 512;
const hasControlCharacter = (name: string) => [...name].some((char) => char.charCodeAt(0) < 32);
const escapesProject = (name: string) =>
  name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "");

/** Rejects anything but a plain relative path before it reaches core; core validates against its candidate list again. */
export function requireCandidateName(name: string): string {
  if (name.length > MAX_NAME_LENGTH || hasControlCharacter(name) || escapesProject(name)) {
    throw new AppError("invalid_request", "Invalid icon name.");
  }
  return name;
}
