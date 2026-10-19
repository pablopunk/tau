import type { RunCommand } from "../update/command-runner";
import type { LifecycleDeps } from "./deps";

/** What bootstrap needs beyond LifecycleDeps; real wiring in `realBootstrapDeps`, fakes in tests. */
export interface BootstrapDeps {
  readonly runCommand: RunCommand;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  /** `realpath(argv[1])`. */
  readonly entry: string;
  readonly platform: NodeJS.Platform;
  readonly readPackageVersion: (packageDir: string) => string | undefined;
  readonly realpath: (path: string) => string;
  /** Resolves `node` from PATH (bunx runs under bun); undefined when there is none. */
  readonly nodeOnPath: () => string | undefined;
}

export type BootstrapResult =
  /** Not a temporary runner (or already bootstrapped): carry on in this process. */
  | { readonly kind: "skip" }
  /** The global tau ran the command; this process exits with `code`. */
  | { readonly kind: "handedOver"; readonly code: number }
  /** Print `message` and exit 1. */
  | { readonly kind: "failed"; readonly message: string };

/** Owner (lifecycle/): npx to global install, verify, hand over (BARE-INSTALL.md section 2). Stub: skips. */
export async function bootstrap(
  _deps: LifecycleDeps,
  _bootstrapDeps: BootstrapDeps | undefined,
  _argv: readonly string[],
): Promise<BootstrapResult> {
  return { kind: "skip" };
}
