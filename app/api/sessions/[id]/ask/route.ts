import { NextResponse } from "next/server";
import { getSession, writeSession } from "@/lib/sessions";
import { askAboutQuestion } from "@/lib/clarify";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MSG = 2000;
const MAX_THREAD = 40;

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const run = prev.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
  locks.set(key, run);
  return gate.then(() => run);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (!session.questions) return NextResponse.json({ error: "No questions in this session." }, { status: 400 });

  let body: { questionIndex?: unknown; message?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const questionIndex = Number(body.questionIndex);
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= session.questions.length) {
    return NextResponse.json({ error: "Invalid questionIndex." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
  if (message.length > MAX_MSG) return NextResponse.json({ error: `Message too long (max ${MAX_MSG} chars).` }, { status: 400 });

  return withLock(`${id}:${questionIndex}`, async () => {
    const fresh = await getSession(id);
    if (!fresh || !fresh.questions) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    const question = fresh.questions[questionIndex];

    const history = (fresh.chats?.[questionIndex] ?? []).slice(-MAX_THREAD);
    const userMsg: ChatMessage = { role: "user", content: message, createdAt: new Date().toISOString() };
    const withUser = [...history, userMsg];

    const result = await askAboutQuestion({ question, history, message });

    const reply: ChatMessage = result.ok
      ? { role: "assistant", content: result.answer, createdAt: new Date().toISOString() }
      : { role: "assistant", content: `⚠️ ${result.error}`, createdAt: new Date().toISOString() };
    const outThread = [...withUser, reply].slice(-MAX_THREAD);

    const chats = { ...(fresh.chats ?? {}), [questionIndex]: outThread };
    await writeSession({ ...fresh, chats });

    return NextResponse.json({ ok: true, thread: outThread });
  });
}
