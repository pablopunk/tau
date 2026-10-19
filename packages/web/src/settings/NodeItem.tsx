import type { DirectoryNode as Node } from "@tau/protocol";
import { PROTOCOL_VERSION } from "@tau/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { NodeRow, NodeRowActions, NodeRowBody, NodeRowVersion } from "@/components/ui/node-row";
import { useUpdateStatus } from "@/lib/queries";
import { placeText } from "@/nodes/directory-text";
import { wasRemoved } from "@/nodes/node-links";
import { osLabel, stateLine } from "@/nodes/node-text";
import { NodeLinks } from "./NodeLinks";
import { NodeMenu } from "./NodeMenu";
import { UpdateCommand, versionState } from "./NodesVersion";
import { RenameNodeForm } from "./RenameNodeForm";

const short = (version: string) => version.slice(0, 8);

function UpdateNote({ node }: { node: Node }) {
  return (
    <div className="flex flex-col gap-1 pt-1 text-xs text-muted-foreground">
      <p>
        Update tau on {node.name}: it runs tau {node.tauVersion} (protocol {short(node.protocolVersion)}
        ), this one speaks protocol {short(PROTOCOL_VERSION)}.
      </p>
      <UpdateCommand />
    </div>
  );
}

function RemovedNote({ node, onReset }: { node: Node; onReset: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
      <p>{node.name} removed this node from its group. Reset this node's identity to join a group again.</p>
      <Button variant="outline" size="xs" onClick={onReset}>
        Reset identity
      </Button>
    </div>
  );
}

export interface NodeItemProps {
  node: Node;
  now: number;
  onDisconnect: (node: Node) => void;
  onForget: (node: Node) => void;
  onRemove: (node: Node) => void;
  onConnect: (node: Node) => void;
  onResetIdentity: () => void;
}

/** One peer: its OS and status, name, links as text, version, and what can be done with it. */
export function NodeItem({
  node,
  now,
  onDisconnect,
  onForget,
  onRemove,
  onConnect,
  onResetIdentity,
}: NodeItemProps) {
  const [renaming, setRenaming] = useState(false);
  const latest = useUpdateStatus().data?.latest ?? null;
  return (
    <NodeRow data-node-id={node.id}>
      {renaming ? (
        <div className="min-w-0 flex-1">
          <RenameNodeForm node={node} onDone={() => setRenaming(false)} />
        </div>
      ) : (
        <>
          <NodeRowBody>
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <NodeAvatar os={node.os} status={node.status} />
              <span className="truncate">{node.name}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {osLabel(node.os)} · {node.threadCount} {node.threadCount === 1 ? "thread" : "threads"} ·{" "}
              {stateLine(node, now)}
            </span>
            <span className="text-xs text-muted-foreground">{placeText(node)}</span>
            <NodeLinks node={node} />
            {node.status === "update-required" ? <UpdateNote node={node} /> : null}
            {wasRemoved(node) ? <RemovedNote node={node} onReset={onResetIdentity} /> : null}
          </NodeRowBody>
          <NodeRowVersion
            version={node.tauVersion}
            state={versionState(node.tauVersion, latest)}
            latest={latest}
          />
          <NodeRowActions>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Connect a node to ${node.name}`}
              disabled={node.status !== "online"}
              onClick={() => onConnect(node)}
            >
              Connect a node
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Rename ${node.name}`}
              onClick={() => setRenaming(true)}
            >
              Rename
            </Button>
            <NodeMenu node={node} onDisconnect={onDisconnect} onForget={onForget} onRemove={onRemove} />
          </NodeRowActions>
        </>
      )}
    </NodeRow>
  );
}
