import type { McpServerStatus } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { useMcpServers } from "@/lib/queries";
import { ClaudeConnectorsSection } from "../ClaudeConnectorsSection";
import { McpServerDialog } from "./McpServerDialog";
import { McpServerRow } from "./McpServerRow";

const WEB_NOTE = "Web search and page fetching work out of the box. No keys needed.";
const MCP_NOTE = "MCP servers add tools the agent can call. They start when first used.";

type DialogState = { readonly editing: string | null } | null;

function ServerList({
  title,
  servers,
  onEdit,
}: {
  title: string;
  servers: McpServerStatus[];
  onEdit?: (name: string) => void;
}) {
  if (servers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul aria-label={title} className="flex flex-col gap-2">
        {servers.map((server) => (
          <McpServerRow key={`${server.source}:${server.name}`} server={server} {...(onEdit && { onEdit })} />
        ))}
      </ul>
    </section>
  );
}

/** This node's own MCP servers. A project's own `.mcp.json` servers are supported automatically, not a setting. */
export function ToolsSection() {
  const servers = useMcpServers(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  if (servers.isError) return <FormError message={errorMessage(servers.error)} />;
  if (servers.isPending) return <Skeleton className="h-9 w-full" />;
  const mine = servers.data.filter((server) => server.source === "settings");

  return (
    <div className="flex flex-col gap-6">
      <SettingRow id="web-search" asChild>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Web search</h3>
          <FieldDescription>{WEB_NOTE}</FieldDescription>
        </section>
      </SettingRow>
      <SettingRow id="mcp-servers" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">MCP servers</h3>
          <Button variant="outline" size="sm" onClick={() => setDialog({ editing: null })}>
            Add server
          </Button>
        </div>
        <FieldDescription>{MCP_NOTE}</FieldDescription>
        {mine.length === 0 ? <FieldDescription>No servers added yet.</FieldDescription> : null}
      </SettingRow>
      <ServerList title="Your servers" servers={mine} onEdit={(name) => setDialog({ editing: name })} />
      <ClaudeConnectorsSection />
      {dialog ? <McpServerDialog editing={dialog.editing} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
