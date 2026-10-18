import type { LoginSession } from "@tau/protocol";
import { type FormEvent, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { FieldDescription } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { api } from "@/lib/api";

export const CALLBACK_PREFIX = "http://127.0.0.1:1455/auth/callback";
const HELP =
  "On another device? After signing in, the page fails to load. Copy its address and paste it here.";
const WRONG_URL = `Paste the full address. It starts with ${CALLBACK_PREFIX}`;

export const isCallbackUrl = (value: string): boolean => value.trim().startsWith(CALLBACK_PREFIX);

interface CallbackUrlFieldProps {
  sessionId: string;
  serverError: string | null;
  onSession: (session: LoginSession) => void;
}

export function CallbackUrlField({ sessionId, serverError, onSession }: CallbackUrlFieldProps) {
  const [value, setValue] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const { run, error, pending } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isCallbackUrl(value)) return setClientError(WRONG_URL);
    setClientError(null);
    await run(async () => onSession(await api.logins.submitUrl(sessionId, value.trim())));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <FieldDescription>{HELP}</FieldDescription>
      <InputGroup>
        <InputGroupInput
          aria-label="Sign-in address"
          autoComplete="off"
          spellCheck={false}
          placeholder={`${CALLBACK_PREFIX}?code=…`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" variant="secondary" disabled={pending || value.trim() === ""}>
            Submit
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FormError message={clientError ?? error ?? serverError} />
    </form>
  );
}
