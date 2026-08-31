import { NextResponse } from "next/server";
import { getSession, patchSession } from "@/lib/sessions";
import { isSessionGenerating } from "@/lib/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json({ session, generating: isSessionGenerating(id) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  let body: { questionIndex?: unknown; selectedIndexes?: unknown; resetAnswers?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.resetAnswers === true) {
    const updated = await patchSession(id, { answers: {} });
    return NextResponse.json({ ok: true, session: updated });
  }

  const questionIndex = Number(body.questionIndex);
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || !session.questions || questionIndex >= session.questions.length) {
    return NextResponse.json({ error: "Invalid questionIndex." }, { status: 400 });
  }

  if (!Array.isArray(body.selectedIndexes)) {
    return NextResponse.json({ error: "selectedIndexes must be an array." }, { status: 400 });
  }
  const selectedIndexes = body.selectedIndexes.map((s: unknown) => Number(s));
  if (selectedIndexes.some((s: number) => !Number.isInteger(s) || s < 0 || s > 3)) {
    return NextResponse.json({ error: "selectedIndexes contain invalid option indexes." }, { status: 400 });
  }

  const question = session.questions[questionIndex];
  const correct = new Set(question.correctIndexes);
  const picked = new Set(selectedIndexes);
  const isCorrect =
    picked.size === correct.size && [...correct].every((c) => picked.has(c as never));

  const answers = {
    ...session.answers,
    [questionIndex]: {
      questionIndex,
      selectedIndexes,
      isCorrect,
      answeredAt: new Date().toISOString(),
    },
  };

  const updated = await patchSession(id, { answers });
  return NextResponse.json({ ok: true, isCorrect, session: updated });
}