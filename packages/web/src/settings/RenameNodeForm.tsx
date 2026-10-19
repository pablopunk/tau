import type { Node } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRenameNode } from "@/lib/queries";

export function RenameNodeForm({ node, onDone }: { node: Node; onDone: () => void }) {
  const rename = useRenameNode();
  const { run, error, pending } = useSubmit();
  const [name, setName] = useState(node.name);
  const save = async () => {
    const next = name.trim();
    if (!next || next === node.name) return onDone();
    if (await run(async () => void (await rename.mutateAsync({ id: node.id, name: next })))) onDone();
  };
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          aria-label="Node name"
          autoFocus
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}
