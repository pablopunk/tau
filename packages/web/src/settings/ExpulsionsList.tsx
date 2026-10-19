import type { Expulsion } from "@tau/protocol";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { useExpulsions } from "@/nodes/NodeRegistry";
import { agoText } from "@/nodes/node-text";

function ExpulsionItem({ expulsion }: { expulsion: Expulsion }) {
  const target = expulsion.targetName ?? expulsion.target;
  const by = expulsion.byName ?? expulsion.by;
  return (
    <li className="flex flex-col gap-0.5 break-words text-sm">
      <span>
        {target} was removed by {by} {agoText(expulsion.at, Date.now())}
      </span>
      {expulsion.pending.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          {expulsion.pending.map((node) => `${node.name} has not confirmed`).join(". ")}.
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Every node confirmed.</span>
      )}
    </li>
  );
}

/** Removed nodes with who removed them and which nodes have not confirmed yet. Hidden when none. */
export function ExpulsionsList() {
  const expulsions = useExpulsions().data ?? [];
  if (expulsions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Removed nodes</FieldLabel>
      <FieldDescription>
        Removing cuts a node off. It does not undo what it did. Run `tau access rotate` to revoke devices and
        swap the token.
      </FieldDescription>
      <ul aria-label="Removed nodes" className="flex flex-col gap-2">
        {expulsions.map((expulsion) => (
          <ExpulsionItem key={expulsion.target} expulsion={expulsion} />
        ))}
      </ul>
    </div>
  );
}
