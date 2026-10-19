import type { Node } from "@tau/protocol";
import { PROTOCOL_VERSION } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { NodeName } from "@/components/ui/node-name";
import { NodeList, NodeRow, NodeRowActions, NodeRowBody, NodeRowVersion } from "@/components/ui/node-row";
import { SettingRow } from "@/components/ui/settings-layout";
import {
  useAllConversations,
  useDisconnectNode,
  useHubLink,
  useRenameNode,
  useUpdateStatus,
} from "@/lib/queries";
import { useNodes } from "@/nodes";
import { osLabel, stateLine } from "@/nodes/node-text";
import { useHubName } from "@/nodes/use-node-avatar";
import { NodeSettingsDialog } from "./NodeSettingsDialog";
import { NodesUpdateBar, UpdateCommand, versionState } from "./NodesVersion";

function RenameForm({ node, onDone }: { node: Node; onDone: () => void }) {
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

function useLatest() {
  return useUpdateStatus().data?.latest ?? null;
}

function NodeItem({
  node,
  now,
  onDisconnect,
  onSettings,
}: {
  node: Node;
  now: number;
  onDisconnect: (node: Node) => void;
  onSettings: (node: Node) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const latest = useLatest();
  return (
    <NodeRow data-node-id={node.id}>
      {renaming ? (
        <div className="min-w-0 flex-1">
          <RenameForm node={node} onDone={() => setRenaming(false)} />
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
            {node.status === "update-required" ? <UpdateNote node={node} /> : null}
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
              aria-label={`Open settings of ${node.name}`}
              disabled={node.status !== "online"}
              onClick={() => onSettings(node)}
            >
              Open settings
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Rename ${node.name}`}
              onClick={() => setRenaming(true)}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Disconnect ${node.name}`}
              onClick={() => onDisconnect(node)}
            >
              Disconnect
            </Button>
          </NodeRowActions>
        </>
      )}
    </NodeRow>
  );
}

function ThisNodeRow() {
  const threads = useAllConversations().data?.length ?? 0;
  const link = useHubLink().data;
  const hubNodeName = useHubName();
  const status = useUpdateStatus().data;
  const hubName = link && link.state !== "none" ? (link.hubName ?? link.hubUrl ?? "a hub") : null;
  return (
    <NodeRow data-node-id="local">
      <NodeRowBody>
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <NodeAvatar os={link?.os} status="online" />
          <NodeName name={hubNodeName} local />
          {hubName ? null : <Badge variant="secondary">Hub</Badge>}
        </span>
        <span className="text-xs text-muted-foreground">
          {threads} {threads === 1 ? "thread" : "threads"} · the tau you are looking at
          {hubName ? `, linked to ${hubName}` : ""}
        </span>
      </NodeRowBody>
      {status ? (
        <NodeRowVersion
          version={status.current}
          state={versionState(status.current, status.latest)}
          latest={status.latest}
        />
      ) : null}
    </NodeRow>
  );
}

export function NodesList() {
  const { nodes } = useNodes();
  const disconnect = useDisconnectNode();
  const { run, error } = useSubmit();
  const [leaving, setLeaving] = useState<Node | null>(null);
  const [settingsOf, setSettingsOf] = useState<Node | null>(null);
  const now = Date.now();
  return (
    <SettingRow id="nodes">
      <div className="flex flex-col gap-3">
        <FieldLabel>Nodes</FieldLabel>
        <NodesUpdateBar nodes={nodes} />
        <NodeList aria-label="Nodes">
          <ThisNodeRow />
          {nodes.map((node) => (
            <NodeItem
              key={node.id}
              node={node}
              now={now}
              onDisconnect={setLeaving}
              onSettings={setSettingsOf}
            />
          ))}
        </NodeList>
        {nodes.length === 0 ? <FieldDescription>No other node is linked yet.</FieldDescription> : null}
        <FormError message={error} />
      </div>
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={`Disconnect ${leaving?.name ?? "node"}?`}
        description="It disappears from this tau and must connect again with a new code. Its threads stay on that node."
        confirmLabel="Disconnect"
        onConfirm={() => {
          const id = leaving?.id;
          setLeaving(null);
          if (id) void run(async () => void (await disconnect.mutateAsync(id)));
        }}
      />
      {settingsOf ? <NodeSettingsDialog node={settingsOf} onClose={() => setSettingsOf(null)} /> : null}
    </SettingRow>
  );
}
