import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MentionItem } from "@/components/ui/mention-menu";
import { api } from "@/lib/api";
import { useSkills } from "@/lib/queries";
import { matchesQuery } from "./mentions";
import { useDebouncedAfterFirst } from "./use-debounced";

const FILE_DEBOUNCE_MS = 120;
const MAX_SKILLS = 8;
const SEARCHING_FILES: MentionItem = {
  id: "status:files",
  label: "Searching files…",
  group: "Files",
  disabled: true,
};

export const fileItemId = (path: string) => `file:${path}`;
export const skillItemId = (name: string) => `skill:${name}`;
export const insertionOf = (id: string) => id.slice(id.indexOf(":") + 1);

export function useMentionItems(projectId: string | null | undefined, query: string | null): MentionItem[] {
  const debounced = useDebouncedAfterFirst(query, FILE_DEBOUNCE_MS);
  const skills = useSkills(projectId ?? null).data ?? [];
  const files = useQuery({
    queryKey: ["suggest-files", projectId, debounced],
    queryFn: () => api.projects.suggestFiles(projectId as string, debounced as string),
    enabled: Boolean(projectId) && debounced !== null,
    placeholderData: keepPreviousData,
  }).data;
  if (query === null) return [];
  const foundFiles = (files ?? []).map((file) => ({
    id: fileItemId(file.path),
    label: file.path,
    group: "Files",
  }));
  const fileItems = projectId && files === undefined ? [SEARCHING_FILES] : foundFiles;
  const skillItems = skills
    .filter((skill) => matchesQuery(skill.name, query))
    .slice(0, MAX_SKILLS)
    .map((skill) => ({
      id: skillItemId(skill.name),
      label: skill.name,
      description: skill.scope === "app" ? `App · ${skill.description}` : skill.description,
      group: "Skills",
    }));
  return [...fileItems, ...skillItems];
}
