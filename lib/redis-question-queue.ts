import Redis from "ioredis";
import type { GenerationQuestion, QuestionSource, QuizSelections, RedisClaim } from "./types";

/**
 * Redis-backed question queue.
 *
 * Each question lives in a sorted set keyed by `technology:difficulty:jobTitle`
 * with `score` = epoch timestamp of when the producer enqueued it. Popping serves
 * the oldest questions first (`ZPOPMIN`); returning an unfinished assessment
 * re-adds them (`ZADD`) with their original timestamps so they're served again
 * before newer entries.
 *
 * Supported URLs (toggle via REDIS_URL env var):
 *   rediss://default:TOKEN@xxx.upstash.io:6379   — Upstash over TLS
 *   redis://localhost:6379                         — local Redis
 *   redis://:PASSWORD@host:port                    — password-protected
 */

let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined && client !== null) return client;

  const url = process.env.REDIS_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  if (!url) {
    client = null;
    console.log("[redis] REDIS_URL not set — Redis queue disabled, using model generation");
    return null;
  }
  try {
    const isUpstash = url.includes("upstash.io");
    console.log(`[redis] connecting to ${isUpstash ? "Upstash" : "Redis"} ${url.replace(/:[^:@]+@/, ":***@")}`);
    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying after 3 attempts
        return Math.min(times * 200, 2000);
      },
    });
    client.on("error", (err: Error) => {
      console.error(`[redis] connection error: ${err.message}`);
    });
    client.on("connect", () => {
      console.log("[redis] connected successfully");
    });
    return client;
  } catch (err) {
    console.error("[redis] failed to create Redis client:", err);
    client = null;
    return null;
  }
}

/** True when a Redis URL is configured. */
export function redisQueueEnabled(): boolean {
  return getClient() !== null;
}

/** The sorted-set key for a technology/difficulty/jobTitle combination. */
export function queueKeyFor(selections: Pick<QuizSelections, "difficulty" | "jobTitle">, technology: string): string {
  return `${technology}:${selections.difficulty}:${selections.jobTitle}`;
}

export interface PoppedQuestion {
  question: GenerationQuestion;
  claim: RedisClaim;
}

/**
 * Pop up to `count` oldest questions from the queue for one key.
 * Returns the parsed questions plus their raw claims (for lossless return on
 * abandon). Throws if the queue is unreachable — callers treat that as a miss.
 */
export async function popQuestions(key: string, count: number, technology: string): Promise<PoppedQuestion[]> {
  const redis = getClient();
  if (!redis) throw new Error("Redis question queue is not configured.");

  console.log(`[redis] popping up to ${count} question(s) from "${key}"`);
  const raw = await redis.zpopmin(key, count);
  console.log(`[redis] zpopmin returned ${raw.length} raw element(s) from "${key}"`);

  // ioredis returns a FLAT array: [member, score, member, score, ...] — never
  // [[member, score], ...]. Group them back into pairs before parsing.
  const pairs: Array<[unknown, number]> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    pairs.push([raw[i], Number(raw[i + 1])]);
  }

  if (pairs.length === 0) {
    console.log(`[redis] key "${key}" is empty — this technology will fall back to model generation`);
    return [];
  }
  console.log(`[redis] ${pairs.length} question(s) to parse from "${key}"`);

  const popped: PoppedQuestion[] = [];
  for (const [member, score] of pairs) {
    const parsed = parseRedisMember(member);
    const question = parsed ? toGenerationQuestion(parsed, technology) : null;
    if (!question) {
      console.warn(`[redis] skipped malformed member in "${key}": ${typeof member === "string" ? member.slice(0, 200) : JSON.stringify(member).slice(0, 200)}`);
      continue;
    }
    popped.push({
      question,
      claim: { key, member: toRawMember(member), score: Number(score) },
    });
  }
  console.log(`[redis] ${popped.length} of ${pairs.length} question(s) parsed from "${key}"`);
  return popped;
}

/** Re-add previously popped questions to their queues with their original scores. */
export async function pushBackClaims(claims: RedisClaim[]): Promise<void> {
  if (claims.length === 0) return;
  const redis = getClient();
  if (!redis) throw new Error("Redis question queue is not configured.");
  const keyCount = new Set(claims.map((c) => c.key)).size;
  console.log(`[redis] returning ${claims.length} claimed question(s) to ${keyCount} key(s)`);
  const pipe = redis.pipeline();
  for (const claim of claims) {
    pipe.zadd(claim.key, claim.score, claim.member);
  }
  await pipe.exec();
}

// ---------------------------------------------------------------------------
// Member parsing / normalization
// ---------------------------------------------------------------------------

type RawMember = Record<string, unknown>;

function toRawMember(member: unknown): string {
  return typeof member === "string" ? member : JSON.stringify(member);
}

function parseRedisMember(member: unknown): RawMember | null {
  if (member && typeof member === "object" && !Array.isArray(member)) return member as RawMember;
  if (typeof member !== "string") return null;
  try {
    const parsed = JSON.parse(member) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RawMember) : null;
  } catch {
    return null;
  }
}

function coerceIsMultiSelect(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function coerceSource(value: unknown): QuestionSource | undefined {
  return value === "model" || value === "official-docs" || value === "interview" ? value : undefined;
}

/**
 * Map the producer's value shape to the app's `GenerationQuestion`. The value
 * may carry extra fields (`id`, `model`, `correctAnswer`) that have no slot in
 * the app schema — `correctAnswer` is only used as a fallback when
 * `correctIndexes` is missing or malformed.
 */
function toGenerationQuestion(raw: RawMember, technology: string): GenerationQuestion | null {
  const question = String(raw.question ?? "").trim();
  if (!question) return null;

  const options = Array.isArray(raw.options) && raw.options.length === 4 ? raw.options.map((o) => String(o)) : [];
  if (!options.every((o) => o.length > 0)) return null;

  const correctIndexes =
    Array.isArray(raw.correctIndexes) && raw.correctIndexes.length >= 1
      ? raw.correctIndexes
          .map((n: unknown) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0 && n < 4)
      : [];
  const resolvedCorrect =
    correctIndexes.length >= 1 ? [...new Set(correctIndexes)].sort((a, b) => a - b) : deriveCorrectIndexes(raw.correctAnswer, options);

  if (resolvedCorrect.length < 1) return null;

  return {
    technology,
    area: String(raw.area ?? ""),
    question,
    isMultiSelect: coerceIsMultiSelect(raw.isMultiSelect),
    options,
    correctIndexes: resolvedCorrect,
    explanation: String(raw.explanation ?? ""),
    source: coerceSource(raw.source),
  };
}

// ---------------------------------------------------------------------------
// correctAnswer -> correctIndexes fallback
// ---------------------------------------------------------------------------

function normalizeText(s: string): string {
  return s.replace(/[""]/g, '"').replace(/['']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

function deriveCorrectIndexes(answer: unknown, options: string[]): number[] {
  const answerText = normalizeText(String(answer ?? ""));
  if (!answerText || options.length !== 4) return [];

  const normOptions = options.map((o) => normalizeText(o.replace(/^[A-Da-d]\s*[:\-]\s*/, "")));

  for (let i = 0; i < normOptions.length; i++) {
    if (normOptions[i] === answerText) return [i];
  }

  for (let i = 0; i < normOptions.length; i++) {
    if (answerText.includes(normOptions[i]) || normOptions[i].includes(answerText)) return [i];
  }

  const answerWords = new Set(answerText.split(/\s+/));
  let best = -1;
  let bestRatio = 0;
  for (let i = 0; i < normOptions.length; i++) {
    const optWords = new Set(normOptions[i].split(/\s+/));
    const shared = [...answerWords].filter((w) => optWords.has(w)).length;
    const ratio = shared / answerWords.size;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = i;
    }
  }
  return bestRatio >= 0.7 ? [best] : [];
}
