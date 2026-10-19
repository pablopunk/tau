const MISE_NODE = /[\\/]mise[\\/]installs[\\/]node[\\/]([^\\/]+)[\\/]/;

/** One line for installs under a mise node: the unit records that node's real path. */
export function miseNotice(node: string, entry: string): string | undefined {
  const version = MISE_NODE.exec(entry)?.[1] ?? MISE_NODE.exec(node)?.[1];
  return version === undefined
    ? undefined
    : `tau is installed under mise node ${version}. If you change node versions, run npx @pablopunk/tau again.`;
}
