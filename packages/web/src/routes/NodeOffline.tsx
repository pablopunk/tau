import type { Node } from "@tau/protocol";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { agoText, updateCommand } from "@/nodes/node-text";

function OfflineBody({ node }: { node: Node }) {
  if (node.status === "update-required") {
    return (
      <>
        <h2 className="text-base font-medium">Update tau on {node.name}</h2>
        <p className="text-sm text-muted-foreground">
          This node runs tau {node.tauVersion}, which does not match this one. Run the command on {node.name},
          then it comes back by itself.
        </p>
        <div className="flex items-center gap-1">
          <code className="rounded-md bg-muted px-2 py-1 text-xs">{updateCommand}</code>
          <CopyButton text={updateCommand} label="Copy update command" />
        </div>
      </>
    );
  }
  return (
    <>
      <h2 className="text-base font-medium">This node is offline</h2>
      <p className="text-sm text-muted-foreground">
        {node.name} was last seen {agoText(node.lastSeenAt, Date.now())}. Its threads come back when it
        connects again.
      </p>
    </>
  );
}

/** Mobile bar for full-page states: the app bar stays hidden on thread URLs. */
function PageBar({ title }: { title: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-1 md:hidden">
      <SidebarTrigger aria-label="Open sidebar" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
    </div>
  );
}

/** Calm state for a thread (or a page) of a node that cannot be reached. */
export function NodeOffline({ node }: { node: Node }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageBar title={node.name} />
      <div
        role="status"
        data-testid="node-offline"
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <NodeAvatar os={node.os} status={node.status} className="size-6" />
        <OfflineBody node={node} />
        <Button asChild variant="outline" size="sm">
          <Link to="/">Back to new thread</Link>
        </Button>
      </div>
    </div>
  );
}

export function NodeUnknown() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageBar title="Node not linked" />
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h2 className="text-base font-medium">This node is not linked</h2>
        <p className="text-sm text-muted-foreground">It was disconnected, or this link is old.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Back to new thread</Link>
        </Button>
      </div>
    </div>
  );
}
