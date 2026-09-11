import { getTechnology, TECHNOLOGIES } from "./technologies";
import type { GenerationQuestion, QuestionSource, QuizSelections } from "./types";

const TIMEOUT_MS = 300_000;

const nameToId = new Map<string, string>(TECHNOLOGIES.map((t) => [t.name, t.id]));

/**
 * Map internal technology ids ("java", "react-nextjs") to the friendly display
 * names the Cloudflare Worker understands ("Java", "React/Next JS"), as in the
 * sample curl payload.
 */
export function techIdsToNames(ids: string[]): string[] {
  return ids.map((id) => getTechnology(id)?.name ?? id);
}

/**
 * Map the worker's returned questions (whose `technology`/`area` are friendly
 * display names) back to the app's internal technology ids so the rest of the
 * pipeline (per-tech counts, dedupe bank, results breakdown) stays consistent.
 */
export function mapTechnologyNamesToIds(questions: GenerationQuestion[]): GenerationQuestion[] {
  return questions.map((q) => {
    const id = nameToId.get(q.technology);
    return id ? { ...q, technology: id } : q;
  });
}

export function getCloudflareWorkerUrl(): string | null {
  const url = process.env.CLOUDFLARE_WORKER_URL;
  return url && url.trim().length > 0 ? url.trim() : null;
}

function computeArea(techId: string, area: string): string {
  const tech = getTechnology(techId);
  if (!tech) return area;
  const known = tech.areas.find((a) => a.name.toLowerCase() === area.toLowerCase());
  return known ? known.name : area;
}

/**
 * Generate questions by POSTing a session-shaped payload to the Cloudflare
 * Worker, which returns a flat JSON array of questions (schema-matched).
 */
export async function generateViaCloudflare(
  selections: QuizSelections,
): Promise<{ ok: true; text: string; questions: GenerationQuestion[] } | { ok: false; error: string }> {
  const url = getCloudflareWorkerUrl();
  if (!url) {
    return { ok: false, error: "CLOUDFLARE_WORKER_URL is not configured." };
  }

  const payload = {
    technologies: techIdsToNames(selections.technologies),
    difficulty: selections.difficulty,
    jobTitle: selections.jobTitle,
    questionsPerTech: selections.questionsPerTech,
    extraSpecifications: selections.extraSpecifications,
  };

  console.log(`[cf] >>> POST ${url}`);
  console.log(`[cf] >>> request body:`, JSON.stringify(payload, null, 2));

  try {
    const startedAt = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const elapsedMs = Date.now() - startedAt;

    const raw = await res.text();
    console.log(`[cf] <<< HTTP ${res.status} in ${elapsedMs}ms (${raw.length} chars)`);
    console.log(`[cf] <<< response body:`, raw.slice(0, 4000));

    if (!res.ok) {
      return { ok: false, error: `Cloudflare Worker HTTP ${res.status}: ${raw.slice(0, 500)}` };
    }

    const normalized = normalizeQuestions(raw);
    console.log(`[cf] <<< mapped to ${normalized.length} valid questions in ${elapsedMs}ms`);
    return { ok: true, text: raw, questions: normalized };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cf] error: ${msg}`);
    return { ok: false, error: `Cloudflare Worker error: ${msg}` };
  }
}

const toZeroBasedIndex = (raw: string | number): number | null => {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    if (raw >= 0 && raw <= 3) return raw;       // already 0-based
    if (raw >= 1 && raw <= 4) return raw - 1;    // 1-based
    return null;
  }
  const s = String(raw).trim();
  const m = s.match(/^([A-Da-d])\s*[:\-]/);
  if (m) return "ABCD".toUpperCase().indexOf(m[1].toUpperCase());
  const n = Number(s);
  if (!Number.isNaN(n) && Number.isInteger(n)) {
    if (n >= 0 && n <= 3) return n;               // already 0-based
    if (n >= 1 && n <= 4) return n - 1;            // 1-based
  }
  return null;
};

// ---------------------------------------------------------------------------
// Explanation-based correctIndexes correction
// ---------------------------------------------------------------------------

const ANSWER_RE = /^\s*Correct:\s*([\s\S]+?)(?:\s+Why the others are wrong|$)/i;

function extractCorrectAnswer(explanation: string): string {
  const m = explanation.match(ANSWER_RE);
  return m ? m[1].trim() : "";
}

function normalizeText(s: string): string {
  return s.replace(/[""]/g, '"').replace(/['']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Find which option best matches the extracted correct-answer text.
 * Uses progressive fallbacks: exact → contains → overlap ratio.
 */
function findOptionIndex(answerText: string, options: string[]): number {
  if (!answerText || options.length === 0) return -1;
  const norm = normalizeText(answerText);

  // 1) exact match (after prefix + case normalization)
  for (let i = 0; i < options.length; i++) {
    const normOpt = normalizeText(options[i].replace(/^[A-Da-d]\s*[:\-]\s*/, ""));
    if (normOpt === norm) return i;
  }

  // 2) answer fully contains option or option fully contains answer
  for (let i = 0; i < options.length; i++) {
    const normOpt = normalizeText(options[i].replace(/^[A-Da-d]\s*[:\-]\s*/, ""));
    if (norm.includes(normOpt) || normOpt.includes(norm)) return i;
  }

  // 3) significant word overlap (≥ 70% of answer words appear in option)
  const answerWords = new Set(norm.split(/\s+/));
  let bestIdx = -1;
  let bestRatio = 0;
  for (let i = 0; i < options.length; i++) {
    const optWords = new Set(normalizeText(options[i].replace(/^[A-Da-d]\s*[:\-]\s*/, "")).split(/\s+/));
    const shared = [...answerWords].filter((w) => optWords.has(w)).length;
    const ratio = shared / answerWords.size;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = i;
    }
  }
  return bestRatio >= 0.7 ? bestIdx : -1;
}

/**
 * Use the explanation's "Correct: ..." sentence to override wrong correctIndexes.
 * The Cloudflare Worker's llama model often mislabels correctIndexes; the
 * explanation text is more reliable. For multi-select, each clause after
 * "Correct:" separated by " / " or " and " is treated as one correct option.
 */
function applyExplanationCorrective(q: GenerationQuestion): GenerationQuestion {
  if (q.options.length !== 4 || !q.explanation) return q;

  const answerText = extractCorrectAnswer(q.explanation);
  if (!answerText) return q;

  const idx = findOptionIndex(answerText, q.options);
  if (idx < 0) return q;

  const currentSet = new Set(q.correctIndexes);
  if (currentSet.size === 1 && currentSet.has(idx)) return q; // already correct

  console.log(`[cf] correctIndex correction: explanation says option ${idx} ("${answerText.slice(0, 80)}") but current indexes were [${q.correctIndexes}]`);
  return { ...q, correctIndexes: [idx] };
}

/**
 * Parse the worker's raw JSON body into questions with internal technology ids.
 * Handles both formats:
 *   - legacy: options = string[], correctIndexes = number[]
 *   - current: options = {isCorrect: boolean, text: string}[], correctIndexes absent
 * Explanation-based correction is always applied as a safety net.
 */
function normalizeQuestions(raw: string): GenerationQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { questions?: unknown }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];

  const mapped: GenerationQuestion[] = [];
  for (const item of list) {
    const q = item as Record<string, unknown>;
    if (!q || typeof q !== "object") continue;
    const techId = nameToId.get(String(q.technology ?? "")) ?? String(q.technology ?? "");

    // --- options: handle both string[] and {isCorrect,text}[] ---
    const rawOptions = Array.isArray(q.options) ? q.options : [];
    let optionTexts: string[] = [];
    let isCorrectFromOptions: boolean[] = [];

    if (rawOptions.length > 0 && typeof rawOptions[0] === "object" && rawOptions[0] !== null && "text" in rawOptions[0]) {
      // new format: {isCorrect, text}[]
      const objs = rawOptions as Array<{ isCorrect?: boolean; text?: string }>;
      optionTexts = objs.map((o) => String(o.text ?? ""));
      isCorrectFromOptions = objs.map((o) => Boolean(o.isCorrect));
    } else {
      // legacy format: string[]
      optionTexts = rawOptions.map((o) => String(o));
    }

    // --- correctIndexes: prefer explicit field, else derive from isCorrect flags ---
    let correctIndexes: number[];
    if (Array.isArray(q.correctIndexes) && q.correctIndexes.length > 0) {
      correctIndexes = q.correctIndexes.map((n: unknown) => toZeroBasedIndex(n as string | number)).filter((n): n is number => n !== null);
    } else if (isCorrectFromOptions.length === 4) {
      correctIndexes = isCorrectFromOptions.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    } else {
      correctIndexes = [];
    }

    const normalized: GenerationQuestion = {
      technology: techId,
      area: computeArea(techId, String(q.area ?? "")),
      question: String(q.question ?? ""),
      isMultiSelect: Boolean(q.isMultiSelect),
      options: optionTexts,
      correctIndexes,
      explanation: String(q.explanation ?? ""),
      source: (["model", "official-docs", "interview"] as QuestionSource[]).includes(q.source as QuestionSource) ? (q.source as QuestionSource) : undefined,
    };
    mapped.push(applyExplanationCorrective(normalized));
  }
  return mapped;
}