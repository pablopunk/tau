import type { ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";

const COMPONENTS: Components = {
  p: (props) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...stripNode(props)} />,
  h1: (props) => <h3 className="mt-4 mb-2 text-lg font-semibold first:mt-0" {...stripNode(props)} />,
  h2: (props) => <h4 className="mt-4 mb-2 text-base font-semibold first:mt-0" {...stripNode(props)} />,
  h3: (props) => <h5 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...stripNode(props)} />,
  h4: (props) => <h6 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...stripNode(props)} />,
  ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5" {...stripNode(props)} />,
  ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5" {...stripNode(props)} />,
  blockquote: (props) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...stripNode(props)} />
  ),
  hr: () => <hr className="my-4" />,
  a: (props) => (
    <a
      className="text-primary underline underline-offset-4"
      target="_blank"
      rel="noopener noreferrer"
      {...stripNode(props)}
    />
  ),
  pre: (props) => <CodeBlock {...stripNode(props)} />,
  code: (props) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...stripNode(props)} />
  ),
  table: (props) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...stripNode(props)} />
    </div>
  ),
  th: (props) => <th className="border px-2 py-1 text-left font-medium" {...stripNode(props)} />,
  td: (props) => <td className="border px-2 py-1" {...stripNode(props)} />,
};

function stripNode<T extends { node?: unknown }>({ node: _node, ...rest }: T): Omit<T, "node"> {
  return rest;
}

export function Markdown({
  children,
  className,
}: { children: string } & Pick<ComponentProps<"div">, "className">) {
  return (
    <div className={cn("min-w-0 break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
