export function threadPaletteLabel(nodeName: string, projectName: string, several: boolean): string {
  return several ? `${nodeName} · ${projectName}` : projectName;
}
