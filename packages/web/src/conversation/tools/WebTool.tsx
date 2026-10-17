import { FileDown, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "../messages/Markdown";
import { resultText } from "../model/tool-state";
import { GenericTool } from "./GenericTool";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";
import {
  answerOf,
  hostOf,
  parseWebResults,
  queriesOf,
  sizeLabel,
  urlsOf,
  type WebResult,
} from "./web-results";

const outputOf = (state: ToolRendererProps["state"]) =>
  state.result ? resultText(state.result) : (state.slot?.output ?? "");

function ResultList({ results }: { results: readonly WebResult[] }) {
  return (
    <ul aria-label="Search results" className="space-y-1.5">
      {results.map((result) => (
        <li key={result.url} className="min-w-0 text-sm">
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-medium text-primary underline-offset-4 hover:underline"
          >
            {result.title}
          </a>
          <span className="block truncate font-mono text-xs text-muted-foreground">{hostOf(result.url)}</span>
        </li>
      ))}
    </ul>
  );
}

function SearchCard({ state }: ToolRendererProps) {
  const text = outputOf(state);
  const results = parseWebResults(text);
  const answer = answerOf(text);
  return (
    <ToolCard
      icon={<Search />}
      title="Web search"
      subtitle={queriesOf(state.call.arguments)}
      status={state.status}
      badge={results.length ? <Badge variant="secondary">{results.length} results</Badge> : null}
    >
      {results.length ? <ResultList results={results} /> : null}
      {answer ? <Markdown className="text-sm">{answer}</Markdown> : null}
    </ToolCard>
  );
}

function FetchCard({ state }: ToolRendererProps) {
  const text = outputOf(state);
  return (
    <ToolCard
      icon={<FileDown />}
      title="Fetch"
      subtitle={urlsOf(state.call.arguments)}
      status={state.status}
      badge={text ? <Badge variant="secondary">{sizeLabel(text.length)}</Badge> : null}
    >
      {text ? <OutputBlock text={text} label="Page content" /> : null}
    </ToolCard>
  );
}

export function WebTool({ state }: ToolRendererProps) {
  if (state.call.name === "web_search") return <SearchCard state={state} />;
  if (state.call.name === "fetch_content") return <FetchCard state={state} />;
  return <GenericTool state={state} />;
}
