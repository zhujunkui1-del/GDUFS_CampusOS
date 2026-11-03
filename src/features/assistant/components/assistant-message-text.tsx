import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent } from "mdast";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import {
  assistantDisplayText,
  containsToolProtocol,
} from "@/lib/assistant-output";
import {
  campusFoodQuery,
  matchesQueryFocus,
  queryFocus,
} from "@/lib/retrieval/query-focus";

/** Transform text nodes only: never rewrite citations inside code or links. */
function citationNodes() {
  return (tree: Root) => {
    const walk = (node: Root | RootContent) => {
      if (
        node.type === "link" ||
        node.type === "linkReference" ||
        !("children" in node)
      )
        return;
      const children: RootContent[] = [];
      for (const child of node.children) {
        if (child.type !== "text") {
          walk(child);
          children.push(child);
          continue;
        }
        let start = 0;
        for (const match of child.value.matchAll(/\[(?:来源\s*)?(\d+)\]/g)) {
          if (match.index > start)
            children.push({
              type: "text",
              value: child.value.slice(start, match.index),
            });
          children.push({
            type: "link",
            url: `#campus-source-${Number(match[1])}`,
            children: [{ type: "text", value: `[${Number(match[1])}]` }],
          });
          start = match.index + match[0].length;
        }
        if (start < child.value.length)
          children.push({ type: "text", value: child.value.slice(start) });
      }
      node.children = children as PhrasingContent[];
    };
    walk(tree);
  };
}

export function AssistantMessageText({
  text,
  cards,
  question = "",
}: {
  text: string;
  cards: AssistantCard[];
  question?: string;
}) {
  if (containsToolProtocol(text)) return <p>{assistantDisplayText(text)}</p>;
  return (
    <div className="assistant-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, citationNodes]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const citation = /^#campus-source-(\d+)$/.exec(href || "");
            if (citation) {
              const number = Number(citation[1]),
                source = cards[number - 1];
              if (
                !source ||
                (source.kind !== "source" &&
                  source.kind !== "external_source") ||
                !/^https?:\/\//i.test(source.originalUrl)
              )
                return null;
              if (
                !matchesQueryFocus(
                  queryFocus(question),
                  source,
                  campusFoodQuery(question),
                )
              )
                return null;
              return (
                <sup className="assistant-citation">
                  <a
                    href={source.originalUrl}
                    title={source.title}
                    aria-label={`来源${number}：${source.title}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    [{number}]
                  </a>
                </sup>
              );
            }
            return href && /^https?:\/\//i.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <>{children}</>
            );
          },
          img: () => null,
          table: ({ children }) => (
            <div className="assistant-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
