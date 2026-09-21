import type { QuizSession } from "./types";
import { getRedisClient } from "./redis-client";

// Session TTL in seconds, set once at creation and never refreshed (1 day from
// creation). Overridable via SESSION_TTL_SECONDS.
const TTL_RAW = Number(process.env.SESSION_TTL_SECONDS ?? 86400);
const SESSION_TTL_SECONDS = Number.isFinite(TTL_RAW) && TTL_RAW > 0 ? Math.floor(TTL_RAW) : 86400;

const SESSION_KEY_PREFIX = "session:";

// In-memory session store persisted across hot reloads via globalThis. Memory is
// the PRIMARY store — reads hit it first; misses fall back to the Redis mirror,
// which doubles as durable storage across server restarts and serverless cold
// starts. All Redis writes are best-effort: a Redis failure never breaks the
// memory copy (mirroring the question queue's graceful-degradation behavior).
const g = globalThis as unknown as { __sessionStore?: Map<string, QuizSession> };
const memStore: Map<string, QuizSession> = g.__sessionStore ??= new Map<string, QuizSession>();

function sessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getSessionFromStore(id: string): Promise<QuizSession | undefined> {
  const hit = memStore.get(id);
  if (hit) return hit;

  // Memory miss — read from the Redis mirror and hydrate into memory so
  // subsequent reads are local. In neither → undefined (callers surface the
  // "Session not found" error).
  const r = getRedisClient();
  if (!r) return undefined;
  try {
    const raw = await r.get(sessionKey(id));
    if (!raw) return undefined;
    const session = JSON.parse(raw) as QuizSession;
    if (session && typeof session === "object" && typeof session.id === "string" && typeof session.createdAt === "string") {
      memStore.set(session.id, session);
      return session;
    }
    console.warn(`[redis-session] dropped malformed session "${id}" read from Redis mirror`);
    return undefined;
  } catch (err) {
    console.error(`[redis-session] read session "${id}" from Redis failed: ${errMsg(err)}`);
    return undefined;
  }
}

export interface SetSessionOptions {
  /** True on first creation — stamps the fixed-from-creation Redis TTL. */
  create?: boolean;
}

export async function setSessionInStore(session: QuizSession, options: SetSessionOptions = {}): Promise<void> {
  memStore.set(session.id, session);

  // Best-effort mirror to Redis; never throw so the memory copy is unaffected.
  const r = getRedisClient();
  if (!r) return;
  const key = sessionKey(session.id);
  const json = JSON.stringify(session);
  try {
    if (options.create) {
      await r.set(key, json, "EX", SESSION_TTL_SECONDS);
      return;
    }
    // Updates must not refresh the creation TTL (fixed expiry). If the key is
    // missing (e.g. session created while Redis was down, or this process just
    // restarted), treat the write as a fresh mirror and apply the full TTL.
    const exists = await r.exists(key);
    if (exists) {
      await r.set(key, json, "KEEPTTL");
    } else {
      await r.set(key, json, "EX", SESSION_TTL_SECONDS);
    }
  } catch (err) {
    console.error(`[redis-session] mirror session "${session.id}" to Redis failed: ${errMsg(err)}`);
  }
}

export async function deleteSessionFromStore(id: string): Promise<void> {
  memStore.delete(id);
  const r = getRedisClient();
  if (!r) return;
  try {
    await r.del(sessionKey(id));
  } catch (err) {
    console.error(`[redis-session] delete session "${id}" from Redis failed: ${errMsg(err)}`);
  }
}

export async function listSessionsFromStore(): Promise<QuizSession[]> {
  const seen = new Map(memStore);

  // Merge in sessions that only live in the Redis mirror (e.g. after a restart,
  // before their first read). In-memory copies win on conflicts.
  const r = getRedisClient();
  if (r) {
    try {
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await r.scan(cursor, "MATCH", `${SESSION_KEY_PREFIX}*`, "COUNT", 100);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0");
      if (keys.length > 0) {
        const raws = await r.mget(...keys);
        for (const raw of raws) {
          if (!raw) continue;
          try {
            const s = JSON.parse(raw) as QuizSession;
            if (
              s &&
              typeof s === "object" &&
              typeof s.id === "string" &&
              typeof s.createdAt === "string" &&
              !seen.has(s.id)
            ) {
              seen.set(s.id, s);
            }
          } catch {
            // skip malformed mirror entries
          }
        }
      }
    } catch (err) {
      console.error(`[redis-session] list from Redis failed: ${errMsg(err)}`);
    }
  }

  return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}