import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MachineAvatar } from "@/components/ui/machine-avatar";
import type { MachineData } from "@/machines";

export const machineKeyOf = (machineId: string | undefined) => machineId ?? "local";

function triggerLabel(machines: readonly MachineData[], selected: readonly string[]) {
  const chosen = machines.filter((machine) => selected.includes(machineKeyOf(machine.machineId)));
  if (chosen.length === 0) return "All machines";
  if (chosen.length === 1) return chosen[0]?.name;
  return `${chosen.length} machines`;
}

const keepOpen = (event: Event) => event.preventDefault();

/** Multi-select machine dropdown. An empty selection means every machine. */
export function MachineFilter({
  machines,
  selected,
  onChange,
}: {
  machines: readonly MachineData[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}) {
  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  return (
    <div className="px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Machine">
            {triggerLabel(machines, selected)}
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuCheckboxItem
            checked={selected.length === 0}
            onSelect={keepOpen}
            onCheckedChange={() => onChange([])}
          >
            All machines
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {machines.map((machine) => {
            const key = machineKeyOf(machine.machineId);
            return (
              <DropdownMenuCheckboxItem
                key={key}
                checked={selected.includes(key)}
                onSelect={keepOpen}
                onCheckedChange={() => toggle(key)}
              >
                <MachineAvatar os={machine.os} status={machine.status} />
                {machine.name}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
