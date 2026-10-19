import type { Node } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { NodeList } from "@/components/ui/node-row";
import { SettingRow } from "@/components/ui/settings-layout";
import { useDisconnectNode, useForgetNode, useResetNodeIdentity } from "@/lib/queries";
import { useNodes } from "@/nodes";
import { ConnectNodeDialog } from "./ConnectNodeDialog";
import { NodeItem } from "./NodeItem";
import { NodeSettingsDialog } from "./NodeSettingsDialog";
import { NodesUpdateBar } from "./NodesVersion";
import { ThisNodeRow } from "./ThisNodeRow";

type Pending = { kind: "disconnect" | "forget"; node: Node } | { kind: "reset" } | null;

const CONFIRMS = {
  disconnect: {
    title: (name: string) => `Disconnect ${name}?`,
    description:
      "The link closes on both nodes and each forgets the other. Connect again with a new code. Threads stay where they are.",
    label: "Disconnect",
  },
  forget: {
    title: (name: string) => `Forget ${name} on this node?`,
    description: "Only this node forgets it: the other node is not told and may still show this one.",
    label: "Forget",
  },
  reset: {
    title: () => "Reset the identity of this node?",
    description:
      "This node gets a new key and a new id and leaves every group it is in. Connect it again with a new code.",
    label: "Reset identity",
  },
} as const;

function PendingConfirm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  onCancel: () => void;
  onConfirm: (pending: NonNullable<Pending>) => void;
}) {
  const copy = pending ? CONFIRMS[pending.kind] : CONFIRMS.disconnect;
  const name = pending && pending.kind !== "reset" ? pending.node.name : "node";
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={copy.title(name)}
      description={copy.description}
      confirmLabel={copy.label}
      onConfirm={() => pending && onConfirm(pending)}
    />
  );
}

function useNodeActions() {
  const disconnect = useDisconnectNode();
  const forget = useForgetNode();
  const reset = useResetNodeIdentity();
  const { run, error } = useSubmit();
  const perform = (pending: NonNullable<Pending>) =>
    run(async () => {
      if (pending.kind === "disconnect") await disconnect.mutateAsync(pending.node.id);
      else if (pending.kind === "forget") await forget.mutateAsync(pending.node.id);
      else await reset.mutateAsync();
    });
  return { perform, error };
}

/** This node and every peer, accepted or dialled, with Connect, Rename, Disconnect, Forget and Reset identity. */
export function NodesList() {
  const { nodes } = useNodes();
  const { perform, error } = useNodeActions();
  const [pending, setPending] = useState<Pending>(null);
  const [settingsOf, setSettingsOf] = useState<Node | null>(null);
  const [connectTo, setConnectTo] = useState<Node | null>(null);
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
              onDisconnect={(target) => setPending({ kind: "disconnect", node: target })}
              onForget={(target) => setPending({ kind: "forget", node: target })}
              onSettings={setSettingsOf}
              onConnect={setConnectTo}
              onResetIdentity={() => setPending({ kind: "reset" })}
            />
          ))}
        </NodeList>
        {nodes.length === 0 ? <FieldDescription>No other node is linked yet.</FieldDescription> : null}
        <FormError message={error} />
      </div>
      <PendingConfirm
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={(chosen) => {
          setPending(null);
          void perform(chosen);
        }}
      />
      {settingsOf ? <NodeSettingsDialog node={settingsOf} onClose={() => setSettingsOf(null)} /> : null}
      <ConnectNodeDialog
        open={connectTo !== null}
        onOpenChange={(open) => !open && setConnectTo(null)}
        node={connectTo ?? undefined}
      />
    </SettingRow>
  );
}
