import { Globe, Terminal } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_MCP_FORM, type McpFormValues, type McpTransport, toMcpConfig } from "./mcp-form";
import { useSaveMcpServer } from "./use-mcp-mutations";

const TRANSPORTS = [
  { value: "stdio", label: "Run a command", icon: <Terminal /> },
  { value: "http", label: "Connect to a URL", icon: <Globe /> },
] as const;

const WRITE_ONLY_NOTE = "Values are saved but never shown again.";

interface McpServerDialogProps {
  readonly editing: string | null;
  readonly onClose: () => void;
}

function StdioFields({
  values,
  set,
}: {
  values: McpFormValues;
  set: (patch: Partial<McpFormValues>) => void;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="mcp-command">Command</FieldLabel>
        <Input
          id="mcp-command"
          value={values.command}
          placeholder="npx"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => set({ command: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="mcp-args">Arguments</FieldLabel>
        <Textarea
          id="mcp-args"
          value={values.args}
          placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
          spellCheck={false}
          onChange={(event) => set({ args: event.target.value })}
        />
        <FieldDescription>One argument per line.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="mcp-env">Environment</FieldLabel>
        <Textarea
          id="mcp-env"
          value={values.env}
          placeholder="API_TOKEN=..."
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => set({ env: event.target.value })}
        />
        <FieldDescription>NAME=value, one per line. {WRITE_ONLY_NOTE}</FieldDescription>
      </Field>
    </>
  );
}

function HttpFields({
  values,
  set,
}: {
  values: McpFormValues;
  set: (patch: Partial<McpFormValues>) => void;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="mcp-url">URL</FieldLabel>
        <Input
          id="mcp-url"
          value={values.url}
          placeholder="https://example.com/mcp"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => set({ url: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="mcp-headers">Headers</FieldLabel>
        <Textarea
          id="mcp-headers"
          value={values.headers}
          placeholder="Authorization: Bearer ..."
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => set({ headers: event.target.value })}
        />
        <FieldDescription>Name: value, one per line. {WRITE_ONLY_NOTE}</FieldDescription>
      </Field>
    </>
  );
}

export function McpServerDialog({ editing, onClose }: McpServerDialogProps) {
  const [values, setValues] = useState<McpFormValues>({ ...EMPTY_MCP_FORM, name: editing ?? "" });
  const save = useSaveMcpServer();
  const { run, error, pending, clearError } = useSubmit();
  const set = (patch: Partial<McpFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(async () => void (await save.mutateAsync(toMcpConfig(values))));
    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing}` : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Saving replaces this server's whole configuration."
              : "Servers are started on demand and shared by every thread."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
              <Input
                id="mcp-name"
                value={values.name}
                readOnly={editing !== null}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Field>
            <SegmentedControl
              aria-label="Connection type"
              value={values.transport}
              options={TRANSPORTS}
              onChange={(transport: McpTransport) => {
                clearError();
                set({ transport });
              }}
            />
            {values.transport === "stdio" ? (
              <StdioFields values={values} set={set} />
            ) : (
              <HttpFields values={values} set={set} />
            )}
          </FieldGroup>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
