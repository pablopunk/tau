import type { Core } from "@pi-everywhere/protocol";

export interface ContractTarget {
  readonly core: Core;
  readonly paths: {
    /** An existing folder, the same one for the same name. */
    directory(name: string): Promise<string>;
    /** An existing regular file. */
    file(name: string): Promise<string>;
    /** A path that does not exist. */
    missing(): string;
  };
  /** Reads a file the agent wrote into a project folder. Absent when the target has no file system. */
  readProjectFile?(directory: string, name: string): Promise<string | undefined>;
  /** Closes `core` and opens a new one on the same data. Absent when the target cannot persist. */
  reopen?(): Promise<Core>;
  dispose(): Promise<void>;
}

export type MakeContractTarget = () => Promise<ContractTarget>;
