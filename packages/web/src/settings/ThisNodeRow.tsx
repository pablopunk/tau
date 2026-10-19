import { useOpenSettings } from "@/app/settings-dialog";
import { Button } from "@/components/ui/button";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { NodeName } from "@/components/ui/node-name";
import { NodeRow, NodeRowActions, NodeRowBody, NodeRowVersion } from "@/components/ui/node-row";
import { StatusChip } from "@/components/ui/status-chip";
import { isConnected } from "@/lib/api";
import {
  useAllConversations,
  useNodeSelf,
  useProviders,
  useResetNodeIdentity,
  useUpdateStatus,
} from "@/lib/queries";
import { localNodeName } from "@/nodes/local-node-name";
import { osLabel } from "@/nodes/node-text";
import { versionState } from "./NodesVersion";

function SetUp() {
  const openProviders = useOpenSettings("providers");
  return (
    <NodeRowActions className="items-center">
      <StatusChip tone="busy">Not set up</StatusChip>
      <Button variant="outline" size="xs" aria-label="Set up this node" onClick={openProviders}>
        Set up
      </Button>
    </NodeRowActions>
  );
}

function RemovedSelf({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
      <p>This node was removed from its group. Reset its identity to join a group again.</p>
      <Button variant="outline" size="xs" onClick={onReset}>
        Reset identity
      </Button>
    </div>
  );
}

/** This tau: its own name and OS from `Core.nodes.self`, "Not set up" with a "Set up" action while it has no provider. */
export function ThisNodeRow() {
  const threads = useAllConversations().data?.length ?? 0;
  const self = useNodeSelf().data;
  const providers = useProviders().data;
  const status = useUpdateStatus().data;
  const reset = useResetNodeIdentity();
  const notSetUp = providers !== undefined && !providers.some(isConnected);
  return (
    <NodeRow data-node-id="local">
      <NodeRowBody>
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <NodeAvatar os={self?.os} status="online" />
          <NodeName name={localNodeName(self?.name)} local />
        </span>
        <span className="text-xs text-muted-foreground">
          {self ? `${osLabel(self.os)} · ` : ""}
          {threads} {threads === 1 ? "thread" : "threads"}
        </span>
        {self?.removed ? <RemovedSelf onReset={() => reset.mutate()} /> : null}
      </NodeRowBody>
      {status ? (
        <NodeRowVersion
          version={status.current}
          state={versionState(status.current, status.latest)}
          latest={status.latest}
        />
      ) : null}
      {notSetUp ? <SetUp /> : null}
    </NodeRow>
  );
}
