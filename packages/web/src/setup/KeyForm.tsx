import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

export function KeyForm({ replacing = false }: { replacing?: boolean }) {
  const id = useId();
  const [key, setKey] = useState("");
  const queryClient = useQueryClient();
  const { run, error, pending } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(async () => {
      await api.provider.setKey(key.trim());
      await queryClient.invalidateQueries({ queryKey: queryKeys.models });
      await queryClient.invalidateQueries({ queryKey: queryKeys.provider });
    });
    if (saved) setKey("");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor={id} className="text-sm font-medium">
        OpenRouter API key
      </label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="sk-or-v1-…"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        aria-invalid={error ? true : undefined}
      />
      <FormError message={error} />
      <Button type="submit" disabled={pending || key.trim() === ""}>
        {pending ? "Checking key…" : replacing ? "Replace key" : "Continue"}
      </Button>
    </form>
  );
}
