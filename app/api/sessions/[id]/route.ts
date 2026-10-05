import { NextResponse } from "next/server";
import type { QuizSession } from "@/lib/types";
import { getSession, patchSession } from "@/lib/sessions";
import { isSessionGenerating } from "@/lib/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upper bound for a client-reported time-on-question (24h).
const MAX_DURATION_MS = 86_400_000;

/**
 * Strips the server-internal queue claims (used to return unfinished assessments
 * to the queue) so raw queue members never reach the browser.
 */
function toPublic(session: QuizSession | null): QuizSession | null {
  if (!session) return null;
  const publicSession = { ...session };
  delete publicSession.redisClaims;
  return publicSession;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json({ session: toPublic(session), generating: isSessionGenerating(id) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  let body: {
    questionIndex?: unknown;
    selectedIndexes?: unknown;
    durationMs?: unknown;
    quizStartedAt?: unknown;
    resetAnswers?: unknown;
    assessmentCompleted?: unknown;
  } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.resetAnswers === true) {
    // "Retry same set": re-run the same questions from scratch. Drop the previous
    // attempt's answers and start stamp (so the retake measures its own time),
    // clear the completion flag so an abandoned retake is handled like any other
    // unfinished assessment, and bump `attempt` so the quiz page lands straight on
    // question 1 instead of the intro. `completedAt` is the *generation*
    // timestamp, so it stays; the per-question chats stay too — same questions,
    // so the threads are still relevant.
    if (session.status !== "complete") {
      return NextResponse.json({ error: "This session is not ready to be retaken." }, { status: 409 });
    }
    const updated = await patchSession(id, {
      answers: {},
      quizStartedAt: undefined,
      assessmentCompleted: false,
      attempt: (session.attempt ?? 1) + 1,
    });
    return NextResponse.json({ ok: true, session: toPublic(updated) });
  }

  // `assessmentCompleted` is also sent alongside a real answer submission (the
  // final question), so only short-circuit when there is no answer in the body.
  const completing = body.assessmentCompleted === true;
  if (completing && body.questionIndex === undefined) {
    const updated = await patchSession(id, { assessmentCompleted: true });
    return NextResponse.json({ ok: true, session: toPublic(updated) });
  }

  // Stamped once when the candidate first enters the question stage. A resume
  // (refresh mid-quiz) re-sends it but must not rewind the clock.
  if (typeof body.quizStartedAt === "string") {
    if (Number.isNaN(Date.parse(body.quizStartedAt))) {
      return NextResponse.json({ error: "quizStartedAt must be an ISO timestamp." }, { status: 400 });
    }
    if (!session.quizStartedAt) {
      const updated = await patchSession(id, { quizStartedAt: body.quizStartedAt });
      return NextResponse.json({ ok: true, session: toPublic(updated) });
    }
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

  // Time-on-question is optional; absent (or out of range) means "not measured".
  let durationMs: number | undefined;
  if (body.durationMs !== undefined) {
    const parsed = Number(body.durationMs);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_DURATION_MS) {
      return NextResponse.json({ error: "durationMs must be between 0 and 86400000." }, { status: 400 });
    }
    durationMs = Math.round(parsed);
  }

  const question = session.questions[questionIndex];
  const correct = new Set(question.correctIndexes);
  const picked = new Set(selectedIndexes);
  const isCorrect =
    picked.size === correct.size && [...correct].every((c) => picked.has(c as never));

  // The answer entry is rebuilt wholesale, so carry over a previously measured
  // duration when this PATCH omits one (e.g. a retried submit).
  const effectiveDurationMs = durationMs ?? session.answers[questionIndex]?.durationMs;

  const answers = {
    ...session.answers,
    [questionIndex]: {
      questionIndex,
      selectedIndexes,
      isCorrect,
      answeredAt: new Date().toISOString(),
      ...(effectiveDurationMs !== undefined ? { durationMs: effectiveDurationMs } : {}),
    },
  };

  const updated = await patchSession(id, {
    answers,
    ...(completing ? { assessmentCompleted: true } : {}),
  });
  return NextResponse.json({ ok: true, isCorrect, session: toPublic(updated) });
}