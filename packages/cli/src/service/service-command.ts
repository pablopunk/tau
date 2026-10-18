/** Owner C implements `tau service install | uninstall | list`. `argv` starts after the word `service`. */
export async function runServiceCommand(_argv: readonly string[]): Promise<void> {
  throw new Error("tau service: not implemented");
}
