import type { Core } from "@pi-everywhere/protocol";

export interface ContractTarget {
  readonly core: Core;
  readonly paths: {
    /** An existing folder, the same one for the same name. */
    directory(name: string): Promise<string>;
    /** An existing regular file. */
    file(name: string): Promise<string>;
    /** An existing folder that is a git repository with a commit. Absent when any folder counts as one. */
    gitDirectory?(name: string): Promise<string>;
    /** A path that does not exist. */
    missing(): string;
    /** A git URL the core can clone successfully (for the real core: a local bare repository). */
    cloneUrl(): Promise<string>;
    /** A well-formed git URL whose clone fails. */
    failingCloneUrl(): string;
  };
  /** Present when the target has a connected GitHub account with these repos (a local copy and none). */
  readonly github?: { readonly repoWithLocalCopy: string; readonly repoWithoutLocalCopy: string };
  /** Reads a file the agent wrote into a project folder. Absent when the target has no file system. */
  readProjectFile?(directory: string, name: string): Promise<string | undefined>;
  /** Creates a file (and its folders) inside a project folder. Absent when the target has no file system. */
  writeProjectFile?(directory: string, name: string, content: string): Promise<void>;
  /** Adds `.agents/skills/<name>/SKILL.md` to a project folder. Absent when the target has no file system. */
  addProjectSkill?(directory: string, name: string, description: string): Promise<void>;
  /** Closes `core` and opens a new one on the same data. Absent when the target cannot persist. */
  reopen?(): Promise<Core>;
  dispose(): Promise<void>;
}

export type MakeContractTarget = () => Promise<ContractTarget>;
