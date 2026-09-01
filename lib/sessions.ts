import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QuizSelections, QuizSession } from "./types";

const DATA_DIR = "/tmp/data";
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

function sessionFile(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

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
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeSession(session);
  } catch {
    // Vercel / serverless: no writable filesystem — session exists in-memory only
  }
  return session;
}

export async function getSession(id: string): Promise<QuizSession | null> {
  try {
    const raw = await readFile(sessionFile(id), "utf8");
    return JSON.parse(raw) as QuizSession;
  } catch {
    return null;
  }
}

export async function writeSession(session: QuizSession): Promise<void> {
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(sessionFile(session.id), JSON.stringify(session, null, 2), "utf8");
  } catch {
    // No-op on read-only filesystems (e.g. Vercel serverless)
  }
}

export async function patchSession(
  id: string,
  patch: Partial<QuizSession>,
): Promise<QuizSession | null> {
  const session = await getSession(id);
  if (!session) return null;
  const updated = { ...session, ...patch, answers: patch.answers ?? session.answers };
  await writeSession(updated);
  return updated;
}

export async function listSessions(): Promise<QuizSession[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    const files = await readdir(SESSIONS_DIR);
    const ids = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    const sessions = await Promise.all(ids.map((id) => getSession(id)));
    return sessions.filter((s): s is QuizSession => s !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    const { rm } = await import("node:fs/promises");
    await rm(sessionFile(id), { force: true });
  } catch {
    // No-op on read-only filesystems
  }
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
