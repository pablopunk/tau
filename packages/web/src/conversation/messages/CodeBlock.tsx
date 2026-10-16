import { type ComponentProps, isValidElement, type ReactNode } from "react";
import { CopyButton } from "@/components/ui/copy-button";

export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  return (
    <div className="group relative my-2">
      <pre
        className="overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0"
        {...props}
      >
        {children}
      </pre>
      <CopyButton text={() => textOf(children)} label="Copy code" className="absolute top-1.5 right-1.5" />
    </div>
  );
}
