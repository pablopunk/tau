import type { ModelInfo, ModelRef } from "@pi-everywhere/protocol";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const sameModel = (a: ModelRef | null, b: ModelInfo) => a?.provider === b.provider && a.modelId === b.modelId;
const searchValue = (model: ModelInfo) => `${model.name} ${model.modelId}`;

interface ModelComboboxProps {
  models: ModelInfo[];
  value: ModelRef | null;
  onChange: (ref: ModelRef) => void;
  id?: string;
  disabled?: boolean;
}

export function ModelCombobox({ models, value, onChange, id, disabled }: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = models.find((model) => sameModel(value, model));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.name ?? "Select a model…"}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={`${model.provider}/${model.modelId}`}
                  value={searchValue(model)}
                  onSelect={() => {
                    onChange({ provider: model.provider, modelId: model.modelId });
                    setOpen(false);
                  }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{model.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{model.modelId}</span>
                  </div>
                  <CheckIcon
                    className={cn("ml-auto", sameModel(value, model) ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
