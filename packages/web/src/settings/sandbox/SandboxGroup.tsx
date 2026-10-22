import type { SandboxSettings } from "@tau/protocol";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useResourceSupport, useSetSandbox, useSettings } from "@/lib/queries";
import { NEEDS_UPDATE, NEW_COMMANDS_ONLY } from "../resources/resources-text";
import { SandboxScopeRow } from "./SandboxScopeRow";
import {
  isSandboxOn,
  SANDBOX_ALL_OFF,
  SANDBOX_BLURB,
  SANDBOX_ON_DEFAULT,
  SANDBOX_SCOPES,
  SANDBOX_UNENFORCED_BLURB,
  type SandboxScope,
  scopeStatus,
} from "./sandbox-text";

export function SandboxGroup() {
  const settings = useSettings();
  const save = useSetSandbox();
  const support = useResourceSupport();
  const value: SandboxSettings | undefined = settings.data?.sandbox;
  if (!settings.data) return null;
  const supported = value !== undefined;
  const capability = support.data?.sandbox;
  // `none` (or an unknown capability) enforces nothing: the toggle would be a lie.
  const enforceable = capability !== undefined && capability.mechanism !== "none";
  const disabled = !supported || !enforceable || save.isPending;
  const on = value ? isSandboxOn(value) : false;
  const update = (scope: SandboxScope, next: boolean) => value && save.mutate({ ...value, [scope]: next });
  const toggle = (next: boolean) =>
    value && save.mutate(next ? { ...SANDBOX_ON_DEFAULT } : { ...SANDBOX_ALL_OFF });
  const unenforcedNote = capability?.note ? ` ${capability.note}` : "";

  return (
    <div className="flex flex-col gap-4" data-testid="sandbox-group">
      {!supported && (
        <p role="status" className="text-sm text-muted-foreground">
          {NEEDS_UPDATE}
        </p>
      )}
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Sandbox</FieldLabel>
          <Switch aria-label="Sandbox" disabled={disabled} checked={on} onCheckedChange={toggle} />
        </div>
        <FieldDescription>
          {supported && !enforceable ? `${SANDBOX_UNENFORCED_BLURB}${unenforcedNote}` : SANDBOX_BLURB}
        </FieldDescription>
      </Field>
      <div className="flex flex-col gap-4">
        {SANDBOX_SCOPES.map(({ key, rowId, label }) => (
          <SandboxScopeRow
            key={key}
            id={rowId}
            label={label}
            scope={key}
            value={value?.[key] ?? false}
            status={scopeStatus(value?.[key] ?? false, capability)}
            disabled={disabled}
            onChange={update}
          />
        ))}
        {supported && enforceable && on && (
          <p className="text-xs text-muted-foreground">{NEW_COMMANDS_ONLY}</p>
        )}
      </div>
    </div>
  );
}
