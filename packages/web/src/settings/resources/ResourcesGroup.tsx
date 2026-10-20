import { ChevronDown } from "lucide-react";
import type { ResourceScope, ResourceSettings } from "@tau/protocol";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FieldLabel } from "@/components/ui/field";
import { useSetResources, useSettings } from "@/lib/queries";
import { ScopeRow } from "./ScopeRow";
import { MEMORY_CAP_NOTE, NEEDS_UPDATE, NEW_COMMANDS_ONLY, SCOPES } from "./resources-text";

export function ResourcesGroup() {
  const settings = useSettings();
  const save = useSetResources();
  const value: ResourceSettings | undefined = settings.data?.resources;
  if (!settings.data) return null;
  const supported = value !== undefined;
  const disabled = !supported || save.isPending;
  const update = (scope: ResourceScope, level: ResourceSettings["levels"][ResourceScope]) =>
    value && save.mutate({ ...value, levels: { ...value.levels, [scope]: level } });

  return (
    <div className="mt-6 flex flex-col gap-4" data-testid="resources-group">
      {!supported && (
        <p role="status" className="text-sm text-muted-foreground">
          {NEEDS_UPDATE}
        </p>
      )}
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-3">
          <FieldLabel>Resource control</FieldLabel>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-4 pt-4">
            {SCOPES.map(({ key, rowId, label, blurb }) => (
              <ScopeRow
                key={key}
                id={rowId}
                label={label}
                blurb={blurb}
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
