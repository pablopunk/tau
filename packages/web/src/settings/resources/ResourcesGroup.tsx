import type { ResourceScope, ResourceSettings } from "@tau/protocol";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useSetResources, useSettings } from "@/lib/queries";
import { isControlOn, MEMORY_CAP_NOTE, NEEDS_UPDATE, NEW_COMMANDS_ONLY, SCOPES } from "./resources-text";
import { ScopeRow } from "./ScopeRow";

const ON_DEFAULT: ResourceSettings["levels"] = { main: "off", worktree: "off", subagent: "balanced" };
const ALL_OFF: ResourceSettings["levels"] = { main: "off", worktree: "off", subagent: "off" };

export function ResourcesGroup() {
  const settings = useSettings();
  const save = useSetResources();
  const value: ResourceSettings | undefined = settings.data?.resources;
  if (!settings.data) return null;
  const supported = value !== undefined;
  const disabled = !supported || save.isPending;
  const on = value ? isControlOn(value) : false;
  const update = (scope: ResourceScope, level: ResourceSettings["levels"][ResourceScope]) =>
    value && save.mutate({ ...value, levels: { ...value.levels, [scope]: level } });
  const toggle = (next: boolean) =>
    value && save.mutate({ ...value, levels: next ? { ...ON_DEFAULT } : { ...ALL_OFF } });

  return (
    <div className="flex flex-col gap-4" data-testid="resources-group">
      {!supported && (
        <p role="status" className="text-sm text-muted-foreground">
          {NEEDS_UPDATE}
        </p>
      )}
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Resource control</FieldLabel>
          <Switch aria-label="Resource control" disabled={disabled} checked={on} onCheckedChange={toggle} />
        </div>
        <FieldDescription>Subagents run at a lower CPU priority. Off is today's behavior.</FieldDescription>
      </Field>
      {on && (
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
      )}
    </div>
  );
}
