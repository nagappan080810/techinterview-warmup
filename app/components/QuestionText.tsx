"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface QuestionTextProps {
  children: string;
  className?: string;
}

export default function QuestionText({ children, className }: QuestionTextProps) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children: codeChildren, className: codeClassName, ...rest } = props;
            const match = /language-(\w+)/.exec(codeClassName || "");
            const inline = !match && !String(codeChildren).includes("\n");
            return inline ? (
              <code
                className="rounded bg-zinc-200 px-1.5 py-0.5 text-sm font-mono dark:bg-zinc-700"
                {...rest}
              >
                {codeChildren}
              </code>
            ) : (
              <div className="my-3 overflow-x-auto rounded-xl text-sm">
                <SyntaxHighlighter
                  style={oneDark}
                  language={match?.[1] || "text"}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: "0.75rem",
                    fontSize: "0.875rem",
                    lineHeight: "1.5",
                  }}
                >
                  {String(codeChildren).replace(/\n$/, "")}
                </SyntaxHighlighter>
              </div>
            );
          },
          p({ children: pChildren }) {
            return <span>{pChildren}</span>;
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
