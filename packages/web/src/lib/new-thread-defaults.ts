import type { ModelInfo, ModelRef, Project, ThinkingLevel } from "@tau/protocol";

export const HOME_PROJECT_ID = "home";

const LEVEL_ORDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const sameModel = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.modelId === b.modelId;

export const findModel = (models: ModelInfo[], ref: ModelRef | null): ModelInfo | undefined =>
  ref ? models.find((model) => sameModel(model, ref)) : undefined;

export function pickModel(
  models: ModelInfo[],
  last: ModelRef | null,
  fallback: ModelRef | null,
): ModelInfo | undefined {
  return findModel(models, last) ?? findModel(models, fallback) ?? models[0];
}

export function clampThinkingLevel(wanted: ThinkingLevel, supported: ThinkingLevel[]): ThinkingLevel {
  if (supported.includes(wanted)) return wanted;
  const below = LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(wanted)).reverse();
  return below.find((level) => supported.includes(level)) ?? supported[0] ?? "off";
}

export function pickThinkingLevel(model: ModelInfo | undefined, last: ThinkingLevel | null): ThinkingLevel {
  return clampThinkingLevel(last ?? "medium", model?.thinkingLevels ?? ["off"]);
}

export function pickProjectId(projects: Project[], wanted: string | null): string {
  const usable = projects.find((project) => project.id === wanted && project.status !== "failed");
  return usable?.id ?? projects.find((project) => project.kind === "home")?.id ?? HOME_PROJECT_ID;
}

export const projectsHomeFirst = (projects: Project[]): Project[] => [
  ...projects.filter((project) => project.kind === "home"),
  ...projects.filter((project) => project.kind !== "home"),
];
