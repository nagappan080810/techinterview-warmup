import { readFile } from "fs/promises";
import { join } from "path";

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

// ---------------------------------------------------------------------------
// Low-level OpenAI-compatible chat completion via fetch
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ToolDefinition {
  type: string;
  parameters?: Record<string, unknown>;
}

interface CompletionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface CompletionResult {
  text: string;
  error?: string;
}

export async function chatCompletion(opts: CompletionOptions): Promise<CompletionResult> {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    tools,
    temperature = 0.1,
    max_tokens = 16384,
    stream = false,
  } = opts;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens,
  };
  if (stream) body.stream = true;
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  // Log request body with truncated messages to avoid flooding console
  const loggedMessages = messages.map((m) => ({
    role: m.role,
    content: m.content.length > 300 ? m.content.slice(0, 300) + "...(" + m.content.length + " chars total)" : m.content,
  }));
  console.log(`[api] >>> REQUEST ${baseUrl}/chat/completions`);
  console.log(`[api] >>> body:`, JSON.stringify({ ...body, messages: loggedMessages }));

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[api] <<< RESPONSE ${model} HTTP ${res.status}:`, errBody.slice(0, 2000));
    return { text: "", error: `HTTP ${res.status}: ${errBody.slice(0, 500)}` };
  }

  if (stream) {
    return await consumeStream(model, res);
  }

  // Clone to read raw text before json parse
  const raw = await res.clone().text();
  console.log(`[api] <<< RESPONSE ${model} (${raw.length} chars):`, raw.slice(0, 2000));

  const data = (await res.json()) as {
    choices?: { message?: { content?: string; reasoning?: string } }[];
    error?: { message?: string };
  };

  if (data.error) {
    console.error(`[api] ${model} API error: ${data.error.message}`);
    return { text: "", error: data.error.message ?? "Unknown API error" };
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  const reasoning = data.choices?.[0]?.message?.reasoning ?? "";
  console.log(`[api] ${model} content: ${text.length} chars, reasoning: ${reasoning.length} chars`);
  return { text };
}

/**
 * Consume an SSE stream from a chat-completions request, accumulating
 * `delta.content` chunks. Once the payload contains a complete, parseable JSON
 * array or object we cancel the stream and return early — this skips whatever
 * trailing text the model would otherwise keep generating and is the main
 * speedup of streaming mode.
 */
async function consumeStream(model: string, res: Response): Promise<CompletionResult> {
  if (!res.body) {
    return { text: "", error: "Streaming response had no body." };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let chunks = "";

  const flush = () => {
    if (!chunks.trim()) return;
    for (const rawLine of chunks.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as {
            choices?: { delta?: { content?: string; reasoning?: string }; message?: { content?: string } }[];
            error?: { message?: string };
          };
          if (evt.error) throw new Error(evt.error.message ?? "stream error");
          const choice = evt.choices?.[0];
          const fragment = choice?.delta?.content ?? choice?.message?.content ?? "";
          if (fragment) text += fragment;
        } catch (err) {
          // A `{error: ...}` event signals a hard failure mid-stream.
          const msg = err instanceof Error ? err.message : String(err);
          return { failed: true, message: msg } as const;
        }
      }
    }
    chunks = "";
    return null;
  };

  // True once the accumulated content contains a complete, parseable JSON
  // value (array for the question set, or object for an {"error": ...} reply).
  const hasCompleteJson = () => {
    const content = text.trim();
    if (!content) return false;
    const startIdx = content[0] === "[" ? content.indexOf("[") : content.indexOf("{");
    const endIdx = content[0] === "[" ? content.lastIndexOf("]") : content.lastIndexOf("}");
    if (startIdx < 0 || endIdx <= startIdx) return false;
    try {
      JSON.parse(content.slice(startIdx, endIdx + 1));
      return true;
    } catch {
      return false;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += decoder.decode(value, { stream: true });
      const failure = flush();
      if (failure) {
        reader.cancel().catch(() => {});
        console.error(`[api] ${model} stream error: ${failure.message}`);
        return { text, error: failure.message };
      }
      // Early exit: payload is already complete valid JSON; stop the model now.
      if (hasCompleteJson()) {
        reader.cancel().catch(() => {});
        console.log(`[api] ${model} stream: complete JSON received, aborting early (${text.length} chars)`);
        return { text };
      }
    }
    chunks += decoder.decode();
    flush();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // AbortSignal.timeout reaching 300s mid-stream surfaces as a generic fetch error.
    console.error(`[api] ${model} stream read error: ${msg}`);
    return { text, error: `Stream ended: ${msg}` };
  }

  console.log(`[api] ${model} stream finished (${text.length} chars)`);
  return { text };
}

// ---------------------------------------------------------------------------
// Provider configs
// ---------------------------------------------------------------------------

export type DirectProvider = "zen" | "openrouter" | "nvidia";

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  tools?: ToolDefinition[];
}

function getZenConfig(): ProviderConfig | null {
  const key = process.env.OPENCODE_ZEN_API_KEY;
  if (!key) return null;
  return {
    baseUrl: ZEN_BASE_URL,
    apiKey: key,
    model: "big-pickle",
  };
}

function getOpenRouterConfig(): ProviderConfig | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  return {
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: key,
    model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
    tools: [{ type: "openrouter:web_search", parameters: { max_results: 5 } }],
  };
}

function getNvidiaConfig(): ProviderConfig | null {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return null;
  return {
    baseUrl: NVIDIA_BASE_URL,
    apiKey: key,
    model: process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
  };
}

export function getProviderConfig(provider: DirectProvider): ProviderConfig | null {
  if (provider === "zen") return getZenConfig();
  if (provider === "nvidia") return getNvidiaConfig();
  return getOpenRouterConfig();
}

// ---------------------------------------------------------------------------
// System prompt loader (cached at module level)
// ---------------------------------------------------------------------------

const promptCache = new Map<string, string>();

async function loadPrompt(filename: string): Promise<string> {
  if (promptCache.has(filename)) return promptCache.get(filename)!;
  const filePath = join(process.cwd(), ".opencode", "prompts", filename);
  const content = await readFile(filePath, "utf-8");
  promptCache.set(filename, content);
  return content;
}

// ---------------------------------------------------------------------------
// Question generation via direct API
// ---------------------------------------------------------------------------

export async function generateQuestionsDirectly(
  userPrompt: string,
  provider: DirectProvider,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const config = getProviderConfig(provider);
  if (!config) {
    console.error(`[api] generateQuestionsDirectly: no API key for provider "${provider}"`);
    return { ok: false, error: `No API key configured for provider "${provider}".` };
  }

  const systemPrompt = await loadPrompt("mcq-generator.txt");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  console.log(`[api] generateQuestionsDirectly: provider=${provider}, model=${config.model}, prompt=${userPrompt.length} chars`);
  const result = await chatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    messages,
    tools: config.tools,
    // Deterministic output (temperature 0) + streaming with early abort as
    // soon as the complete JSON is received speeds up generation. We do not
    // use response_format: json_object because it can force an object root,
    // while the mcq-generator prompt must emit a JSON array.
    temperature: 0,
    stream: false,
  });

  if (result.error) {
    console.error(`[api] generateQuestionsDirectly: provider=${provider} failed: ${result.error}`);
    return { ok: false, error: `Direct API (${provider}) error: ${result.error}` };
  }
  if (!result.text.trim()) {
    console.error(`[api] generateQuestionsDirectly: provider=${provider} returned empty output`);
    return { ok: false, error: `Direct API (${provider}) returned empty output.` };
  }
  console.log(`[api] generateQuestionsDirectly: provider=${provider} success (${result.text.length} chars)`);
  return { ok: true, text: result.text };
}

// ---------------------------------------------------------------------------
// Clarification via direct API
// ---------------------------------------------------------------------------

export async function askClarificationDirectly(
  payload: Record<string, unknown>,
  provider: DirectProvider,
): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  const config = getProviderConfig(provider);
  if (!config) {
    console.error(`[api] askClarificationDirectly: no API key for provider "${provider}"`);
    return { ok: false, error: `No API key configured for provider "${provider}".` };
  }

  const systemPrompt = await loadPrompt("mcq-clarify.txt");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(payload) },
  ];

  console.log(`[api] askClarificationDirectly: provider=${provider}, model=${config.model}`);
  const result = await chatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    messages,
    temperature: 0.5,
    max_tokens: 2048,
  });

  if (result.error) {
    console.error(`[api] askClarificationDirectly: provider=${provider} failed: ${result.error}`);
    return { ok: false, error: `Direct API (${provider}) error: ${result.error}` };
  }
  if (!result.text.trim()) {
    console.error(`[api] askClarificationDirectly: provider=${provider} returned empty answer`);
    return { ok: false, error: `Direct API (${provider}) returned empty answer.` };
  }
  console.log(`[api] askClarificationDirectly: provider=${provider} success (${result.text.length} chars)`);
  return { ok: true, answer: result.text.trim() };
}
