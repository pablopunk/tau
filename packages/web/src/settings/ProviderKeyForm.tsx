import type { ProviderInfo } from "@tau/protocol";
import { type FormEvent, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useSetProviderKey } from "@/lib/queries";

interface ProviderKeyFormProps {
  provider: ProviderInfo;
  onSaved: () => void;
}

export function ProviderKeyForm({ provider, onSaved }: ProviderKeyFormProps) {
  const [key, setKey] = useState("");
  const setProviderKey = useSetProviderKey();
  const { run, error, pending } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(async () => {
      await setProviderKey.mutateAsync({ id: provider.id, key: key.trim() });
    });
    if (saved) onSaved();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupInput
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${provider.name} API key`}
          aria-invalid={error ? true : undefined}
          placeholder="Paste your API key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" variant="secondary" disabled={pending || key.trim() === ""}>
            {pending ? "Checking…" : "Save"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FormError message={error} />
      <Button variant="link" size="sm" className="self-start px-0" asChild>
        <a href={provider.keyUrl} target="_blank" rel="noreferrer">
          Get a key
        </a>
      </Button>
    </form>
  );
}
