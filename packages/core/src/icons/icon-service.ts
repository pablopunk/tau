import { readFile } from "node:fs/promises";
import { AppError, type Project, type ProjectIconImage } from "@tau/protocol";
import { deleteCustomIcon, hashIcon, readCustomIcon, writeCustomIcon } from "./custom-icon";
import { type FoundIcon, findCandidates, findFirstIcon } from "./discovery";

const CACHE_MILLISECONDS = 60_000;

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

const notFound = () => new AppError("not_found", "This image is not available.");

async function load(found: FoundIcon): Promise<ProjectIconImage | null> {
  try {
    const data = new Uint8Array(await readFile(found.file));
    return { contentType: found.contentType, data, etag: `${found.mtimeMs}-${found.size}` };
  } catch {
    return null;
  }
}

export function createIconService(deps: IconServiceDeps): IconService {
  const { iconsDirectory, now } = deps;
  const cache = new Map<string, { at: number; found: FoundIcon | null }>();

  async function discovered(project: Project): Promise<FoundIcon | null> {
    const hit = cache.get(project.id);
    if (hit && now() - hit.at < CACHE_MILLISECONDS) return hit.found;
    const found = await findFirstIcon(project.path);
    cache.set(project.id, { at: now(), found });
    return found;
  }

  return {
    async icon(project) {
      const custom = await readCustomIcon(iconsDirectory, project.id);
      if (custom) return { contentType: "image/png", data: custom, etag: hashIcon(custom) };
      const found = await discovered(project);
      return found ? load(found) : null;
    },
    async candidates(project) {
      return (await findCandidates(project.path)).map(({ name }) => ({ name }));
    },
    async candidate(project, name) {
      const found = (await findCandidates(project.path)).find((item) => item.name === name);
      const image = found ? await load(found) : null;
      if (!image) throw notFound();
      return image;
    },
    async setCustom(projectId, png) {
      if (png === null) return deleteCustomIcon(iconsDirectory, projectId);
      await writeCustomIcon(iconsDirectory, projectId, png);
    },
    async version(projectId) {
      const custom = await readCustomIcon(iconsDirectory, projectId);
      return custom ? hashIcon(custom) : "auto";
    },
    async removeCustom(projectId) {
      cache.delete(projectId);
      await deleteCustomIcon(iconsDirectory, projectId);
    },
  };
}
