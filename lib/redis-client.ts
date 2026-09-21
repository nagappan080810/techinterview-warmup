import Redis from "ioredis";

/**
 * Shared Redis client used by the question queue (lib/redis-question-queue.ts)
 * and the durable session-store backup (lib/session-store.ts). A single lazy
 * singleton keeps one connection across the whole process; when Redis is not
 * configured or unreachable, `getRedisClient()` returns null and each caller
 * degrades gracefully (queue → model generation, sessions → in-memory only).
 *
 * Supported URLs (toggle via REDIS_URL env var):
 *   rediss://default:TOKEN@xxx.upstash.io:6379   — Upstash over TLS
 *   redis://localhost:6379                         — local Redis
 *   redis://:PASSWORD@host:port                    — password-protected
 */

let client: Redis | null | undefined;

export function getRedisClient(): Redis | null {
  if (client !== undefined && client !== null) return client;

  const url = process.env.REDIS_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  if (!url) {
    client = null;
    console.log("[redis] REDIS_URL not set — Redis disabled");
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

/** True when a Redis connection is available (configured and reachable). */
export function redisConfigured(): boolean {
  return getRedisClient() !== null;
}