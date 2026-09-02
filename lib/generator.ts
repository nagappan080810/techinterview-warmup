import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk/client";
import { appendToBank, getExistingQuestions } from "./question-bank";
import { generateQuestionsDirectly, type DirectProvider } from "./openai-direct";
import { patchSession } from "./sessions";
import type { GenerationQuestion, QuizSelections } from "./types";

const AGENT = "mcq-generator";
const PROJECT_ROOT = process.cwd();
const SDK_PORT = Number(process.env.OPENCODE_SDK_PORT ?? 4097);
const SDK_TIMEOUT_MS = Number(process.env.MCQ_GENERATOR_TIMEOUT_MS ?? 360_000);
const USE_EMBEDDED = process.env.USE_EMBEDDED_OPENCODE !== "false";
const OPENROUTER_ONLY = process.env.OPENROUTER_ONLY === "true";
const NVIDIA_ONLY = process.env.NVIDIA_ONLY === "true";

// One lazily-started embedded opencode server shared across the whole Next.js
// process. We spawn `opencode serve` once and reuse it (the CLI binary provides
// the runtime; the @opencode-ai/sdk provides the client). If the port is
// already taken by a leftover instance from an earlier dev-server reload, we
// just connect to it instead of spawning a duplicate.
// Returns null when USE_EMBEDDED_OPENCODE=false or when the server can't start.
let clientPromise: Promise<OpencodeClient | null> | null = null;

export function getEmbeddedClient(): Promise<OpencodeClient | null> {
  if (!clientPromise) {
    clientPromise = startEmbeddedServer();
  }
  return clientPromise;
}

async function startEmbeddedServer(): Promise<OpencodeClient | null> {
  if (!USE_EMBEDDED) return null;
  try {
    const { client } = await createOpencode({
      hostname: "127.0.0.1",
      port: SDK_PORT,
      timeout: 30_000,
    });
    return client;
  } catch {
    try {
      return createOpencodeClient({ baseUrl: `http://127.0.0.1:${SDK_PORT}` });
    } catch {
      return null;
    }
  }
}

type GenerationResult =
  | { ok: true; questions: GenerationQuestion[] }
  | { ok: false; error: string };

interface GenerationJob {
  sessionId: string;
}

const activeJobs = new Map<string, GenerationJob>();

const AREAS_BY_TECH: Record<string, string[]> = {
  java: ["Core Java & OOP", "Collections & Generics", "Concurrency", "JVM Internals & Java 21"],
  "core-dsa": ["Arrays & Strings", "Linked Lists & Trees", "Graphs & Search", "Dynamic Programming & Complexity"],
  "system-design": ["Scalability & Caching", "Data & Storage", "Distributed Systems", "Architecture Patterns"],
  react: ["Hooks", "Rendering & Performance"],
  "react-nextjs": ["App Router & Data", "Server Components & Actions"],
  angular: ["Signals & State", "Core Concepts", "Change Detection & Performance"],
  "node-backend": ["Node Runtime", "APIs & Services", "Databases & Queues"],
  "spring-boot": ["Core & Auto-configuration", "Data & Messaging", "Cloud & Resilience"],
  auth: ["Authentication", "Authorization"],
  "design-patterns": ["Creational", "Structural", "Behavioral"],
  "twelve-factor": ["Core Factors", "Operations Factors"],
  kubernetes: ["Workloads & Config", "Networking & Services", "Scaling & Operations"],
};

const COMPLETE = "complete";
const ERROR = "error";

/** Returns true if a generation is already running for the given session. */
export function isSessionGenerating(sessionId: string): boolean {
  return activeJobs.has(sessionId);
}

/** Kick off background generation for a session. Returns immediately; progress is written to the session file. */
export async function startGeneration(sessionId: string, selections: QuizSelections): Promise<void> {
  if (activeJobs.has(sessionId)) return;
  const job: GenerationJob = { sessionId };
  activeJobs.set(sessionId, job);
  void runGeneration(job, selections);
}

async function runGeneration(job: GenerationJob, selections: QuizSelections): Promise<void> {
  const { sessionId } = job;
  const techs = selections.technologies.join(", ");
  const totalQ = selections.technologies.length * selections.questionsPerTech;
  console.log(`[gen] session ${sessionId}: starting generation (${techs}, ${selections.difficulty}, ${selections.jobTitle}, ${totalQ} questions)`);
  try {
    await patchSession(sessionId, {
      status: "generating",
      lastEventAt: new Date().toISOString(),
      eventCount: 0,
      error: undefined,
    });

    const existing = await getExistingQuestions(selections, []);
    console.log(`[gen] session ${sessionId}: ${existing.length} existing questions in bank`);

    // When embedded opencode is disabled, split technologies 50/50 between
    // Zen (model knowledge) and OpenRouter (web search) for diverse questions.
    if (!USE_EMBEDDED) {
      console.log(`[gen] session ${sessionId}: using direct API path (embedded disabled)`);
      const result = await runSplitGeneration(job, selections, existing);
      if (!result.ok) {
        console.error(`[gen] session ${sessionId}: generation failed: ${result.error}`);
        await patchSession(sessionId, { status: ERROR, error: result.error, completedAt: new Date().toISOString() });
        return;
      }
      const questions = shuffleCorrectPositions(enforcePerTechCount(result.questions, selections));
      await appendToBank(questions, sessionId, selections);
      console.log(`[gen] session ${sessionId}: complete (${questions.length} questions)`);
      await patchSession(sessionId, {
        status: COMPLETE,
        questions,
        generatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: undefined,
      });
      return;
    }

    // Embedded path: use opencode serve
    console.log(`[gen] session ${sessionId}: using embedded opencode SDK path`);
    const prompt = buildPrompt({ sessionId, selections, existing });

    // Retry once on parse/empty-output failures — the model occasionally misses
    // the trailing newline in the event stream or emits a non-JSON summary.
    let result = await spawnOpenCode(job, prompt);
    if (!result.ok && /no question JSON|not valid JSON|zero valid questions/.test(result.error)) {
      console.log(`[gen] session ${sessionId}: retrying after parse failure: ${result.error}`);
      await patchSession(sessionId, {
        status: "generating",
        lastEventAt: new Date().toISOString(),
      });
      result = await spawnOpenCode(job, prompt);
    }

    if (!result.ok) {
      console.error(`[gen] session ${sessionId}: generation failed: ${result.error}`);
      await patchSession(sessionId, { status: ERROR, error: result.error, completedAt: new Date().toISOString() });
      return;
    }

    const questions = shuffleCorrectPositions(enforcePerTechCount(result.questions, selections));
    await appendToBank(questions, sessionId, selections);
    console.log(`[gen] session ${sessionId}: complete (${questions.length} questions)`);
    await patchSession(sessionId, {
      status: COMPLETE,
      questions,
      generatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gen] session ${sessionId}: unexpected error: ${msg}`);
    await patchSession(sessionId, {
      status: ERROR,
      error: msg,
      completedAt: new Date().toISOString(),
    });
  } finally {
    activeJobs.delete(sessionId);
  }
}

/** 50/50 split generation: half via Zen (model knowledge), half via OpenRouter (web search). */
async function runSplitGeneration(
  job: GenerationJob,
  selections: QuizSelections,
  existing: Array<{ question: string; technology: string; area: string }>,
): Promise<GenerationResult> {
  const { sessionId } = job;
  const techs = selections.technologies;

  // When NVIDIA_ONLY=true, send all techs to NVIDIA (skip Zen and OpenRouter)
  if (NVIDIA_ONLY) {
    console.log(`[gen] session ${sessionId}: NVIDIA_ONLY mode — all techs → NVIDIA`);
    const providers: Array<{ techs: string[]; provider: DirectProvider }> = [
      { techs, provider: "nvidia" },
    ];
    return await runProviderBatches(job, selections, existing, providers);
  }

  // When OPENROUTER_ONLY=true, send all techs to OpenRouter (skip Zen entirely)
  if (OPENROUTER_ONLY) {
    console.log(`[gen] session ${sessionId}: OPENROUTER_ONLY mode — all techs → OpenRouter`);
    const providers: Array<{ techs: string[]; provider: DirectProvider }> = [
      { techs, provider: "openrouter" },
    ];
    return await runProviderBatches(job, selections, existing, providers);
  }

  const mid = Math.ceil(techs.length / 2);
  const zenTechs = techs.slice(0, mid);
  const orTechs = techs.slice(mid);

  console.log(`[gen] session ${sessionId}: provider split — Zen: [${zenTechs.join(", ")}], OpenRouter: [${orTechs.join(", ")}]`);

  const providers: Array<{ techs: string[]; provider: DirectProvider }> = [];
  if (zenTechs.length > 0) providers.push({ techs: zenTechs, provider: "zen" });
  if (orTechs.length > 0) providers.push({ techs: orTechs, provider: "openrouter" });

  return await runProviderBatches(job, selections, existing, providers);
}

async function runProviderBatches(
  job: GenerationJob,
  selections: QuizSelections,
  existing: Array<{ question: string; technology: string; area: string }>,
  providers: Array<{ techs: string[]; provider: DirectProvider }>,
): Promise<GenerationResult> {
  const { sessionId } = job;
  const results: GenerationQuestion[] = [];
  const failedBatches: Array<{ techs: string[]; provider: DirectProvider; reason: string }> = [];

  for (const { techs: batchTechs, provider } of providers) {
    const batchSelections = { ...selections, technologies: batchTechs };
    const prompt = buildPrompt({ sessionId, selections: batchSelections, existing });

    console.log(`[gen] session ${sessionId}: calling ${provider} for [${batchTechs.join(", ")}] (${selections.questionsPerTech} q/tech)`);

    // Retry once on parse failures
    let result = await generateQuestionsDirectly(prompt, provider);
    if (!result.ok && /no question JSON|not valid JSON|zero valid questions/.test(result.error)) {
      console.log(`[gen] session ${sessionId}: ${provider} retry after parse failure: ${result.error}`);
      await patchSession(sessionId, { lastEventAt: new Date().toISOString() });
      result = await generateQuestionsDirectly(prompt, provider);
    }

    if (!result.ok) {
      console.warn(`[gen] session ${sessionId}: ${provider} batch failed: ${result.error}`);
      failedBatches.push({ techs: batchTechs, provider, reason: result.error });
      continue;
    }

    const jsonText = extractJson(result.text);
    if (!jsonText) {
      const reason = `Direct API (${provider}) returned no question JSON in its output.`;
      console.warn(`[gen] session ${sessionId}: ${provider} returned no question JSON`);
      failedBatches.push({ techs: batchTechs, provider, reason });
      continue;
    }

    const parsed = parseQuestions(jsonText);
    if (!parsed.ok) {
      console.warn(`[gen] session ${sessionId}: ${provider} parse failed: ${parsed.error}`);
      failedBatches.push({ techs: batchTechs, provider, reason: parsed.error });
      continue;
    }
    console.log(`[gen] session ${sessionId}: ${provider} returned ${parsed.questions.length} valid questions`);
    results.push(...parsed.questions);
  }

  // Fallback: for each failed batch, retry its techs through the other provider
  if (failedBatches.length > 0) {
    for (const failed of failedBatches) {
      // NVIDIA and Zen both fall back to OpenRouter; OpenRouter falls back to Zen
      const fallbackProvider: DirectProvider = failed.provider === "openrouter" ? "zen" : "openrouter";
      console.warn(`[gen] session ${sessionId}: ${failed.provider} failed for [${failed.techs.join(", ")}] — falling back to ${fallbackProvider} (reason: ${failed.reason})`);

      const fallbackSelections = { ...selections, technologies: failed.techs };
      const fallbackPrompt = buildPrompt({ sessionId, selections: fallbackSelections, existing });

      let fallbackResult = await generateQuestionsDirectly(fallbackPrompt, fallbackProvider);
      if (!fallbackResult.ok && /no question JSON|not valid JSON|zero valid questions/.test(fallbackResult.error)) {
        console.log(`[gen] session ${sessionId}: ${fallbackProvider} fallback retry after parse failure`);
        fallbackResult = await generateQuestionsDirectly(fallbackPrompt, fallbackProvider);
      }

      if (!fallbackResult.ok) {
        console.error(`[gen] session ${sessionId}: ${fallbackProvider} fallback also failed: ${fallbackResult.error}`);
        return { ok: false, error: `${failed.provider} failed (${failed.reason}), ${fallbackProvider} fallback also failed: ${fallbackResult.error}` };
      }

      const jsonText = extractJson(fallbackResult.text);
      if (!jsonText) {
        return { ok: false, error: `${failed.provider} failed, ${fallbackProvider} fallback returned no question JSON.` };
      }

      const parsed = parseQuestions(jsonText);
      if (!parsed.ok) {
        return { ok: false, error: `${failed.provider} failed, ${fallbackProvider} fallback parse error: ${parsed.error}` };
      }
      console.log(`[gen] session ${sessionId}: ${fallbackProvider} fallback returned ${parsed.questions.length} valid questions`);
      results.push(...parsed.questions);
    }
  }

  if (results.length === 0) {
    return { ok: false, error: "All API providers failed to generate any questions." };
  }
  console.log(`[gen] session ${sessionId}: total generated ${results.length} questions from providers`);
  return { ok: true, questions: results };
}

function buildPrompt(params: {
  sessionId: string;
  selections: QuizSelections;
  existing: Array<{ question: string; technology: string; area: string }>;
}): string {
  const { sessionId, selections, existing } = params;
  const areasByTechnology: Record<string, string[]> = {};
  for (const tech of selections.technologies) {
    const areas = AREAS_BY_TECH[tech] ?? [];
    if (areas.length > 0) areasByTechnology[tech] = areas;
  }

  return JSON.stringify(
    {
      sessionId,
      technologies: selections.technologies,
      difficulty: selections.difficulty,
      jobTitle: selections.jobTitle,
      questionsPerTech: selections.questionsPerTech,
      areasByTechnology,
      existingQuestions: existing,
      extraSpecifications: selections.extraSpecifications,
    },
    null,
    2,
  );
}

async function spawnOpenCode(job: GenerationJob, prompt: string): Promise<GenerationResult> {
  const { sessionId } = job;
  let eventCount = 0;

  // Keep the session file fresh so any polling client (and the server on restart)
  // can see live progress. Throttled to at most once per 500ms to avoid write spam.
  let lastTouch = 0;
  function touchEvent() {
    const now = Date.now();
    if (now - lastTouch < 500) return;
    lastTouch = now;
    eventCount += 1;
    void patchSession(sessionId, { lastEventAt: new Date().toISOString(), eventCount });
  }

  // Watchdog: if the agent goes silent past the timeout, abort the run.
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  let sessionAbort: (() => void) | null = null;
  const armWatchdog = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      sessionAbort?.();
      timedOut = true;
    }, SDK_TIMEOUT_MS);
  };

  try {
    console.log(`[gen] session ${sessionId}: obtaining embedded client`);
    const client = await getEmbeddedClient();
    if (!client) {
      console.error(`[gen] session ${sessionId}: embedded client unavailable`);
      return { ok: false, error: "Embedded opencode server is not available." };
    }
    console.log(`[gen] session ${sessionId}: creating opencode session`);
    const created = await client.session.create({
      query: { directory: PROJECT_ROOT },
      body: { title: "MCQ generation" },
    });
    if (!created.data) {
      const e = created.error as { message?: string } | undefined;
      const msg = e?.message ?? "unknown";
      console.error(`[gen] session ${sessionId}: failed to create SDK session: ${msg}`);
      return { ok: false, error: `Failed to create opencode session: ${msg}` };
    }
    const sdkSessionId = created.data.id;
    console.log(`[gen] session ${sessionId}: SDK session created (id: ${sdkSessionId})`);
    sessionAbort = () => {
      try {
        void client.session.abort({ path: { id: sdkSessionId }, query: { directory: PROJECT_ROOT } });
      } catch {
        // best-effort
      }
    };

    // Stream live events for this SDK session so the frontend sees progress.
    let outputText = "";
    const unsub = subscribeToSessionEvents(client, sdkSessionId, () => {
      touchEvent();
      armWatchdog();
    });
    try {
      armWatchdog();
      console.log(`[gen] session ${sessionId}: dispatching prompt to agent "${AGENT}"`);
      const res = await client.session.prompt({
        path: { id: sdkSessionId },
        query: { directory: PROJECT_ROOT },
        body: { agent: AGENT, parts: [{ type: "text", text: prompt }] },
      });
      if (!res.data) {
        const e = res.error as { message?: string } | undefined;
        const msg = e?.message ?? "unknown";
        console.error(`[gen] session ${sessionId}: agent failed to respond: ${msg}`);
        return { ok: false, error: `Agent failed to respond: ${msg}` };
      }

      if (res.data.info?.error) {
        const e = res.data.info.error as { message?: string; body?: unknown };
        const msg = e.message ?? (typeof e.body === "string" ? e.body : "unknown");
        console.error(`[gen] session ${sessionId}: agent error: ${msg}`);
        return { ok: false, error: `Agent reported an error during generation: ${msg}` };
      }
      if (res.data.parts) {
        for (const part of res.data.parts) {
          if (part.type === "text" && part.text) outputText += part.text;
        }
      }
      console.log(`[gen] session ${sessionId}: agent responded (${outputText.length} chars, ${eventCount} events)`);
    } finally {
      unsub();
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const jsonText = extractJson(outputText);
    if (jsonText) {
      const parsed = parseQuestions(jsonText);
      if (parsed.ok) {
        console.log(`[gen] session ${sessionId}: parsed ${parsed.questions.length} valid questions`);
      } else {
        console.error(`[gen] session ${sessionId}: parse failed: ${parsed.error}`);
      }
      return parsed.ok ? { ok: true, questions: parsed.questions } : { ok: false, error: parsed.error };
    }
    if (timedOut) {
      console.error(`[gen] session ${sessionId}: timed out after ${Math.round(SDK_TIMEOUT_MS / 1000)}s`);
      return { ok: false, error: `Generation timed out after ${Math.round(SDK_TIMEOUT_MS / 1000)}s of no events from the agent.` };
    }
    console.error(`[gen] session ${sessionId}: agent finished but no question JSON found`);
    return { ok: false, error: "Agent finished but no question JSON was found in its output." };
  } catch (err) {
    if (timedOut) {
      return { ok: false, error: `Generation timed out after ${Math.round(SDK_TIMEOUT_MS / 1000)}s of no events from the agent.` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gen] session ${sessionId}: SDK error: ${msg}`);
    if (/exited|EADDRINUSE|ECONNREFUSED|Failed to|not.*on PATH/i.test(msg)) {
      return { ok: false, error: `Could not reach the embedded opencode server: ${msg}` };
    }
    return { ok: false, error: `Generation failed via opencode SDK: ${msg}` };
  }
}

/** Subscribe to the server's global event stream, invoking onEvent for events that belong to the given SDK session. */
function subscribeToSessionEvents(client: OpencodeClient, sdkSessionId: string | null, onEvent: () => void): () => void {
  let disposed = false;
  const stop = () => {
    disposed = true;
  };
  try {
    void client.global
      .event({
        onSseEvent: (ev) => {
          if (disposed) return;
          const e = ev as unknown as { type?: string; properties?: { sessionID?: string } };
          if (sdkSessionId && e.properties?.sessionID === sdkSessionId) onEvent();
        },
      })
      .catch(() => {
        // Event subscription is best-effort; progress is optional.
      });
  } catch {
    // ignore
  }
  return stop;
}

function extractJson(output: string): string | null {
  const candidates: string[] = [];

  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fenced) {
    candidates.push(...fenced.map((f) => f.replace(/^```[a-z]*\s*/, "").replace(/```$/, "").trim()));
  }

  const startArr = output.indexOf("[");
  const endArr = output.lastIndexOf("]");
  if (startArr >= 0 && endArr > startArr) candidates.push(output.slice(startArr, endArr + 1));

  const startErr = output.indexOf('{"error"');
  if (startErr >= 0) candidates.push(output.slice(startErr));

  for (const c of candidates) {
    try {
      JSON.parse(c);
      return c;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Cap each technology at the requested questionsPerTech (the model occasionally over-delivers). */
function enforcePerTechCount(questions: GenerationQuestion[], selections: QuizSelections): GenerationQuestion[] {
  const allowed = new Map<string, number>();
  for (const tech of selections.technologies) allowed.set(tech, selections.questionsPerTech);
  const counts = new Map<string, number>();
  const out: GenerationQuestion[] = [];
  for (const q of questions) {
    const cap = allowed.get(q.technology) ?? Infinity;
    const used = counts.get(q.technology) ?? 0;
    if (used >= cap) continue;
    counts.set(q.technology, used + 1);
    out.push(q);
  }
  return out;
}

/** Fisher–Yates shuffle (in place, returns the same array). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Randomly reposition the correct answer(s) on every question, guaranteeing the
 * correct option is not always the same letter across a set regardless of what
 * the model emitted. Options are permuted and `correctIndexes` are remapped to
 * their new positions, so correctness/scoring is preserved.
 */
function shuffleCorrectPositions(questions: GenerationQuestion[]): GenerationQuestion[] {
  return questions.map((q) => {
    const order = shuffle([0, 1, 2, 3]);
    const options = order.map((i) => q.options[i]);
    const correctIndexes = q.correctIndexes.map((c) => order.indexOf(c)).sort((a, b) => a - b);
    return { ...q, options, correctIndexes };
  });
}

function parseQuestions(text: string): { ok: true; questions: GenerationQuestion[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Generated output was not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "error" in parsed) {
    return { ok: false, error: `Agent reported an error: ${String((parsed as { error: string }).error)}` };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Agent output did not contain a JSON array of questions." };
  }

  const questions: GenerationQuestion[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Partial<GenerationQuestion>;
    const source = raw.source === "model" || raw.source === "official-docs" || raw.source === "interview" ? raw.source : undefined;
    const q: GenerationQuestion = {
      technology: String(raw.technology ?? ""),
      area: String(raw.area ?? ""),
      question: String(raw.question ?? ""),
      isMultiSelect: Boolean(raw.isMultiSelect),
      options: Array.isArray(raw.options) && raw.options.length === 4 ? raw.options.map((o) => String(o)) : [],
      correctIndexes: Array.isArray(raw.correctIndexes) ? raw.correctIndexes.map((n) => Number(n)) : [],
      explanation: String(raw.explanation ?? ""),
      source,
    };
    const valid =
      q.question.length > 0 &&
      q.options.length === 4 &&
      q.options.every((o) => o.length > 0) &&
      q.correctIndexes.length >= 1 &&
      q.correctIndexes.every((n) => Number.isInteger(n) && n >= 0 && n < 4);
    if (!valid) {
      return {
        ok: false,
        error: `Question ${i + 1} is malformed (expected exactly 4 options, 1 correct index for single-select, valid indexes).`,
      };
    }
    questions.push(q);
  }

  if (questions.length === 0) {
    return { ok: false, error: "Agent generated zero valid questions." };
  }
  return { ok: true, questions };
}