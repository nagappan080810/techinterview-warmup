"use client";

import { useState } from "react";

export default function SessionBadge({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — non-fatal
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Click to copy session id"
      className="group inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-1 font-mono text-xs text-zinc-100 transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      <span className="uppercase tracking-wide text-[10px] text-zinc-400 dark:text-zinc-500">session</span>
      <span className="font-semibold">{sessionId}</span>
      <span className="text-zinc-400 group-hover:text-zinc-200 dark:text-zinc-500 dark:group-hover:text-zinc-700">
        {copied ? "✓" : "⧉"}
      </span>
    </button>
  );
}
