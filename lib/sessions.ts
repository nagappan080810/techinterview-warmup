import type { QuizSelections, QuizSession } from "./types";
import {
  getSessionFromStore,
  setSessionInStore,
  deleteSessionFromStore,
  listSessionsFromStore,
} from "./session-store";

export async function createSession(selections: QuizSelections): Promise<QuizSession> {
  const session: QuizSession = {
    id: generateId(),
    selections,
    status: "queued",
    createdAt: new Date().toISOString(),
    eventCount: 0,
    answers: {},
    chats: {},
  };
  setSessionInStore(session);
  return session;
}

export async function getSession(id: string): Promise<QuizSession | null> {
  return getSessionFromStore(id) ?? null;
}

export async function writeSession(session: QuizSession): Promise<void> {
  setSessionInStore(session);
}

export async function patchSession(
  id: string,
  patch: Partial<QuizSession>,
): Promise<QuizSession | null> {
  const session = await getSession(id);
  if (!session) return null;
  const updated = { ...session, ...patch, answers: patch.answers ?? session.answers };
  setSessionInStore(updated);
  return updated;
}

export async function listSessions(): Promise<QuizSession[]> {
  return listSessionsFromStore();
}

export async function deleteSession(id: string): Promise<void> {
  deleteSessionFromStore(id);
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
