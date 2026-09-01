import { readFile } from "fs/promises";
import { join } from "path";

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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
}

export interface CompletionResult {
  text: string;
  error?: string;
}

export async function chatCompletion(opts: CompletionOptions): Promise<CompletionResult> {
  const { baseUrl, apiKey, model, messages, tools, temperature = 0.7, max_tokens = 16384 } = opts;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens,
  };
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

// ---------------------------------------------------------------------------
// Provider configs
// ---------------------------------------------------------------------------

export type DirectProvider = "zen" | "openrouter";

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

export function getProviderConfig(provider: DirectProvider): ProviderConfig | null {
  return provider === "zen" ? getZenConfig() : getOpenRouterConfig();
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
    temperature: 0.7,
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
