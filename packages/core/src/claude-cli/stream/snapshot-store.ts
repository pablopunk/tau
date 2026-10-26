import { type BindingSnapshot, loadBindingSnapshots, saveBindingSnapshots } from "./binding-store";

type Rows = Record<string, BindingSnapshot>;

export interface SnapshotStore {
  find(sessionId: string): Promise<BindingSnapshot | undefined>;
  /** Applies `change` to the loaded rows once earlier updates are in. It returns whether a save is due. */
  update(change: (rows: Rows) => boolean): void;
  /** Resolves when every update so far is saved, or reported as failed. */
  flush(): Promise<void>;
}

/** One load, one writer: updates apply in order and a burst of them is saved once, with the last state. */
export function createSnapshotStore(file: string, onSaveError: (error: unknown) => void): SnapshotStore {
  let loading: Promise<Rows> | undefined;
  const rows = (): Promise<Rows> => {
    loading ??= loadBindingSnapshots(file);
    return loading;
  };
  let inLine = Promise.resolve();
  let updatesWaiting = 0;
  let saveDue = false;
  const saveWhenNoUpdateIsWaiting = async (current: Rows): Promise<void> => {
    if (updatesWaiting > 0 || !saveDue) return;
    saveDue = false;
    await saveBindingSnapshots(file, current).catch(onSaveError);
  };
  return {
    async find(sessionId) {
      return (await rows())[sessionId];
    },
    update(change) {
      updatesWaiting += 1;
      inLine = inLine.then(async () => {
        const current = await rows();
        updatesWaiting -= 1;
        if (change(current)) saveDue = true;
        await saveWhenNoUpdateIsWaiting(current);
      });
    },
    flush: () => inLine,
  };
}
