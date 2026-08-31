import { getEmbeddedClient } from "./generator";
import type { ChatMessage, GenerationQuestion } from "./types";

const AGENT = "mcq-clarify";
const PROJECT_ROOT = process.cwd();
const CLARIFY_TIMEOUT_MS = Number(process.env.MCQ_CLARIFY_TIMEOUT_MS ?? 90_000);

export type AskResult = { ok: true; answer: string } | { ok: false; error: string };

interface AskQuestionRequest {
  question: GenerationQuestion;
  history: ChatMessage[];
  message: string;
}

/** Resolve with the prompt result, but reject after `ms` if the agent stalls, best-effort aborting it. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`Clarification timed out after ${Math.round(ms / 1000)}s of waiting for the agent.`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Ask the mcq-clarify agent a follow-up question about a single quiz question. */
export async function askAboutQuestion(req: AskQuestionRequest): Promise<AskResult> {
  const client = await getEmbeddedClient();
  const payload = {
    question: req.question.question,
    options: req.question.options,
    correctIndexes: req.question.correctIndexes,
    isMultiSelect: req.question.isMultiSelect,
    explanation: req.question.explanation,
    history: req.history.slice(-8),
    message: req.message,
  };

  try {
    const created = await client.session.create({
      query: { directory: PROJECT_ROOT },
      body: { title: "MCQ clarify" },
    });
    if (!created.data) {
      const e = created.error as { message?: string } | undefined;
      return { ok: false, error: `Failed to create opencode session: ${e?.message ?? "unknown"}` };
    }
    const sdkSessionId = created.data.id;

    const abortAgent = () => {
      try {
        void client.session.abort({ path: { id: sdkSessionId }, query: { directory: PROJECT_ROOT } });
      } catch {
        // best-effort
      }
    };

    const res = await withTimeout(
      client.session.prompt({
        path: { id: sdkSessionId },
        query: { directory: PROJECT_ROOT },
        body: {
          agent: AGENT,
          parts: [{ type: "text", text: JSON.stringify(payload) }],
        },
      }),
      CLARIFY_TIMEOUT_MS,
      abortAgent,
    );

    if (!res.data) {
      const e = res.error as { message?: string } | undefined;
      return { ok: false, error: `Agent failed to respond: ${e?.message ?? "unknown"}` };
    }
    if (res.data.info?.error) {
      const e = res.data.info.error as { message?: string; body?: unknown };
      const msg = e.message ?? (typeof e.body === "string" ? e.body : "unknown");
      return { ok: false, error: `Agent reported an error: ${msg}` };
    }

    let answer = "";
    if (res.data.parts) {
      for (const part of res.data.parts) {
        if (part.type === "text" && part.text) answer += part.text;
      }
    }
    answer = answer.trim();
    if (!answer) {
      return { ok: false, error: "Agent returned an empty answer." };
    }
    return { ok: true, answer };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(msg)) {
      return { ok: false, error: msg };
    }
    if (/exited|EADDRINUSE|ECONNREFUSED|Failed to|not.*on PATH/i.test(msg)) {
      return { ok: false, error: `Could not reach the embedded opencode server: ${msg}` };
    }
    return { ok: false, error: `Clarification failed via opencode SDK: ${msg}` };
  }
}
