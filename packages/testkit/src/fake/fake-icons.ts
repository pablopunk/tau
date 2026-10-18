import { AppError, isIconPng, type ProjectIconImage, projectIconUrl } from "@tau/protocol";

const hashOf = (bytes: Uint8Array) => {
  let hash = 5381;
  for (const byte of bytes) hash = ((hash << 5) + hash + byte) >>> 0;
  return hash.toString(36);
};

export interface FakeIcons {
  version(projectId: string): string;
  iconUrl(projectId: string): string;
  icon(projectId: string): ProjectIconImage | null;
  set(projectId: string, png: Uint8Array | null): void;
  forget(projectId: string): void;
}

/** The fake has no project folders, so only custom icons exist and there are never candidates. */
export function createFakeIcons(): FakeIcons {
  const custom = new Map<string, { data: Uint8Array; version: string }>();
  const version = (projectId: string) => custom.get(projectId)?.version ?? "auto";
  return {
    version,
    iconUrl: (projectId) => projectIconUrl(projectId, version(projectId)),
    icon: (projectId) => {
      const entry = custom.get(projectId);
      return entry ? { contentType: "image/png", data: entry.data } : null;
    },
    set(projectId, png) {
      if (png === null) {
        custom.delete(projectId);
        return;
      }
      if (!isIconPng(png)) throw new AppError("invalid_request", "The icon must be a 128x128 PNG.");
      custom.set(projectId, { data: png.slice(), version: hashOf(png) });
    },
    forget: (projectId) => void custom.delete(projectId),
  };
}
