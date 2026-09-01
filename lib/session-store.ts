import type { QuizSession } from "./types";

// In-memory session store persisted across hot reloads via globalThis.
// On Vercel each serverless function instance gets its own Map, so sessions
// survive within a single instance lifecycle but not across cold starts.
// Future: swap this implementation for Upstash Redis.
const g = globalThis as unknown as { __sessionStore?: Map<string, QuizSession> };
const store: Map<string, QuizSession> = g.__sessionStore ??= new Map<string, QuizSession>();

export function getSessionFromStore(id: string): QuizSession | undefined {
  return store.get(id);
}

export function setSessionInStore(session: QuizSession): void {
  store.set(session.id, session);
}

export function deleteSessionFromStore(id: string): void {
  store.delete(id);
}

export function listSessionsFromStore(): QuizSession[] {
  return [...store.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}
