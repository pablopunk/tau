import type { DirectoryNode } from "@tau/protocol";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GROUP_FULL_TEXT, hasClockSkew, isGroupFull, skewText } from "@/nodes/directory-text";

/** Group-level warnings: clock skew with any node, and the cap of 16. */
export function NodeGroupNotes({ nodes }: { nodes: readonly DirectoryNode[] }) {
  const skewed = nodes.filter(hasClockSkew);
  if (skewed.length === 0 && !isGroupFull(nodes)) return null;
  return (
    <div className="flex flex-col gap-2">
      {skewed.map((node) => (
        <Alert key={node.id} role="status">
          <AlertDescription>{skewText(node)}</AlertDescription>
        </Alert>
      ))}
      {isGroupFull(nodes) ? (
        <Alert role="status">
          <AlertDescription>{GROUP_FULL_TEXT}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
