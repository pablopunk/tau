import type { ResourceScope, ResourceSettings } from "@tau/protocol";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { useResourceSupport, useSetResources, useSettings } from "@/lib/queries";
import { MEMORY_CAP_NOTE, NEEDS_UPDATE, NEW_COMMANDS_ONLY, SCOPES } from "./resources-text";
import { ScopeRow } from "./ScopeRow";

export function ResourcesGroup() {
  const settings = useSettings();
  const save = useSetResources();
  const support = useResourceSupport();
  const value: ResourceSettings | undefined = settings.data?.resources;
  if (!settings.data) return null;
  const supported = value !== undefined;
  // `other` platforms enforce nothing: editable rows would be a lie.
  const enforceable = support.data?.platform !== "other";
  const disabled = !supported || !enforceable || save.isPending;
  const update = (scope: ResourceScope, level: ResourceSettings["levels"][ResourceScope]) =>
    value && save.mutate({ ...value, levels: { ...value.levels, [scope]: level } });

  return (
    <div className="flex flex-col gap-4" data-testid="resources-group">
      {!supported && (
        <p role="status" className="text-sm text-muted-foreground">
          {NEEDS_UPDATE}
        </p>
      )}
      <Field>
        <FieldLabel>Resource control</FieldLabel>
        <FieldDescription>
          {enforceable
            ? "Subagents run at a lower CPU priority. Off is today's behavior."
            : "Resource control is not available on this node."}
        </FieldDescription>
      </Field>
      <div className="flex flex-col gap-4">
        {SCOPES.map(({ key, rowId, label }) => (
          <ScopeRow
            key={key}
            id={rowId}
            label={label}
            scope={key}
            value={value?.levels[key] ?? "off"}
            disabled={disabled}
            onChange={update}
          />
        ))}
        {supported && (
          <p className="text-xs text-muted-foreground">
            {NEW_COMMANDS_ONLY} {MEMORY_CAP_NOTE}
          </p>
        )}
      </div>
    </div>
  );
}
