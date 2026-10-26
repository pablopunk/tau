import { Separator } from "@/components/ui/separator";
import { ResourcesGroup } from "@/settings/resources/ResourcesGroup";
import { SandboxGroup } from "@/settings/sandbox/SandboxGroup";

/** Sandboxing plus CPU/memory caps: one section so Agent stays readable. */
export function LimitsSection() {
  return (
    <div className="flex flex-col gap-4">
      <ResourcesGroup />
      <Separator />
      <SandboxGroup />
    </div>
  );
}
