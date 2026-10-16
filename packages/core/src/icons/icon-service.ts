import { AppError, type Project, type ProjectIconImage } from "@pi-everywhere/protocol";
import { notImplemented } from "../not-implemented";

export interface IconServiceDeps {
  /** `<home>/icons`: custom icons live here as `<projectId>.png`. */
  readonly iconsDirectory: string;
  readonly now: () => number;
}

export interface IconService {
  /** The custom icon, else the discovered one; `null` when none. Never called for Home. */
  icon(project: Project): Promise<ProjectIconImage | null>;
  /** Relative names, best first, at most 12. */
  candidates(project: Project): Promise<{ name: string }[]>;
  /** Rejects `not_found` for a name that is not a current candidate. */
  candidate(project: Project, name: string): Promise<ProjectIconImage>;
  /** The caller has validated the PNG; `null` deletes the custom icon. */
  setCustom(projectId: string, png: Uint8Array | null): Promise<void>;
  /** The custom icon's hash, or "auto". */
  version(projectId: string): Promise<string>;
  removeCustom(projectId: string): Promise<void>;
}

export function createIconService(_deps: IconServiceDeps): IconService {
  return {
    icon: async () => null,
    candidates: async () => [],
    candidate: async () => {
      throw new AppError("not_found", "This image is not available.");
    },
    setCustom: async () => {
      throw notImplemented("icons.setCustom");
    },
    version: async () => "auto",
    removeCustom: async () => {},
  };
}
