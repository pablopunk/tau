import type { Node } from "@tau/protocol";
import { linkText, visibleLinks } from "@/nodes/node-links";

/** One line per link, as text: who connected to whom and the state. Never a tooltip. */
export function NodeLinks({ node }: { node: Node }) {
  const links = visibleLinks(node);
  if (links.length === 0) return null;
  return (
    <ul aria-label={`Links of ${node.name}`} className="flex flex-col text-xs text-muted-foreground">
      {links.map((link) => (
        <li key={link.direction}>{linkText(link)}</li>
      ))}
    </ul>
  );
}
