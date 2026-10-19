import type { DirectoryNode } from "@tau/protocol";
import { useSubmit } from "@/app/use-submit";
import { TypedConfirmDialog } from "@/components/ui/typed-confirm-dialog";
import { useRemoveNode } from "@/lib/queries";

/** Group-wide Remove: says what it affects and what it cannot undo, and asks to type the node's name. */
export function RemoveNodeDialog({ node, onClose }: { node: DirectoryNode | null; onClose: () => void }) {
  const remove = useRemoveNode();
  const { run, error, pending, clearError } = useSubmit();
  const confirm = async () => {
    if (!node) return;
    const done = await run(() => remove.mutateAsync({ id: node.id, confirm: node.name }));
    if (done) onClose();
  };
  return (
    <TypedConfirmDialog
      open={node !== null}
      onOpenChange={(open) => {
        if (open) return;
        clearError();
        onClose();
      }}
      title={`Remove ${node?.name ?? "node"} from the group?`}
      phrase={node?.name ?? ""}
      confirmLabel="Remove from group"
      onConfirm={() => void confirm()}
      error={error}
      busy={pending}
      description={
        <>
          <p>
            Every node in the group cuts it off. It has to reset its identity and be paired again to come
            back.
          </p>
          <p>
            Removing cuts access. It cannot undo what the node already did or took, such as files, tokens or
            keys it read. Run `tau access rotate` afterwards to revoke devices and swap the token.
          </p>
        </>
      }
    />
  );
}
