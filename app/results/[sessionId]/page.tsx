"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GenerationQuestion, QuizSession } from "@/lib/types";
import { formatDuration } from "@/lib/format";
import { downloadJson } from "@/lib/download";
import SessionBadge from "@/app/components/SessionBadge";
import QuestionText from "@/app/components/QuestionText";

const OPTION_LABELS = ["A", "B", "C", "D"];

/** Verdict for one option, relative to what the candidate picked. */
type OptionState = "correct-picked" | "correct-missed" | "wrong-picked" | "ignored";

interface OptionRow {
  index: number;
  label: string;
  text: string;
  state: OptionState;
}

interface Row {
  q: GenerationQuestion;
  selected: number[];
  isCorrect: boolean;
  answered: boolean;
  durationMs?: number;
  options: OptionRow[];
}

/** Badge, text colour and glyph for each verdict — the single legend for the
 *  quiz page and the results page, so the two screens read identically. */
const OPTION_STATE: Record<OptionState, { badge: string; text: string; glyph: string; label: string }> = {
  "correct-picked": {
    badge: "border-emerald-600 bg-emerald-500 text-white dark:border-emerald-500 dark:bg-emerald-400 dark:text-zinc-900",
    text: "text-emerald-700 dark:text-emerald-400",
    glyph: "✓",
    label: "Correct — you picked this",
  },
  "correct-missed": {
    badge: "border-amber-600 bg-amber-100 text-amber-800 dark:border-amber-400 dark:bg-amber-950/60 dark:text-amber-300",
    text: "text-amber-700 dark:text-amber-400",
    glyph: "⊘",
    label: "Correct — you missed this",
  },
  "wrong-picked": {
    badge: "border-red-600 bg-red-500 text-white dark:border-red-500 dark:bg-red-400 dark:text-zinc-900",
    text: "text-red-700 dark:text-red-400",
    glyph: "✗",
    label: "Not correct — you picked this",
  },
  ignored: {
    badge: "border-zinc-300 dark:border-zinc-600",
    text: "text-zinc-500 dark:text-zinc-400",
    glyph: "",
    label: "",
  },
};

const MARKER_CHIP: Record<OptionState, string> = {
  "correct-picked": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  "correct-missed": "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  "wrong-picked": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  ignored: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function ResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<QuizSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const explanationsRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) throw new Error("not found");
        const data = (await res.json()) as { session: QuizSession };
        setSession(data.session);
      } catch {
        setError("Could not load results for this session.");
      }
    })();
  }, [sessionId]);

  // A complete session with no answers has nothing to report: its attempt was
  // just cleared ("Retry same set") and the user reached this URL via Back or a
  // paste — send them into the quiz rather than render an all-unanswered 0% page.
  useEffect(() => {
    if (!session || session.status !== "complete") return;
    if (Object.keys(session.answers ?? {}).length > 0) return;
    router.replace(`/quiz/${sessionId}`);
  }, [session, sessionId, router]);

  const setAllExplanations = (open: boolean) => {
    explanationsRef.current?.querySelectorAll("details").forEach((d) => {
      d.open = open;
    });
  };

  if (error || (session && session.status !== "complete")) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-6 py-24 text-center">
        <div>
          <p className="mb-4 text-red-600 dark:text-red-400">{error ?? "This quiz never completed generation."}</p>
          <Link href="/" className="btn btn-sm btn-secondary">
            Back to welcome page
          </Link>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-6 py-24 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800 dark:border-zinc-700 dark:border-t-zinc-200" />
      </main>
    );
  }

  const questions = session.questions ?? [];
  const rows: Row[] = questions.map((q, i) => {
    const a = session.answers[i];
    const answered = !!a;
    const selected = a?.selectedIndexes ?? [];
    const correctSet = new Set(q.correctIndexes);
    const pickedSet = new Set(selected);
    const isCorrect =
      answered && pickedSet.size === correctSet.size && [...correctSet].every((c) => pickedSet.has(c as never));
    return {
      q,
      selected,
      isCorrect,
      answered,
      durationMs: a?.durationMs,
      options: q.options.map((text, o) => {
        const picked = selected.includes(o);
        const correct = correctSet.has(o);
        const state: OptionState = correct
          ? picked
            ? "correct-picked"
            : "correct-missed"
          : picked
            ? "wrong-picked"
            : "ignored";
        return { index: o, label: OPTION_LABELS[o] ?? String(o), text, state };
      }),
    };
  });

  const correctCount = rows.filter((r) => r.isCorrect).length;
  const answeredCount = rows.filter((r) => r.answered).length;
  const pct = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;

  const perTech = rows.reduce<Record<string, { correct: number; total: number }>>((acc, r) => {
    acc[r.q.technology] = acc[r.q.technology] ?? { correct: 0, total: 0 };
    acc[r.q.technology].total += 1;
    if (r.isCorrect) acc[r.q.technology].correct += 1;
    return acc;
  }, {});

  const s = session.selections;
  const attempt = session.attempt ?? 1;

  const timedRows = rows
    .map((r, i) => ({ index: i, durationMs: r.durationMs }))
    .filter((t): t is { index: number; durationMs: number } => typeof t.durationMs === "number");

  // Total time taken: session start stamp → completion (or the last answer).
  // `measuredTotalMs` is the weaker signal — the sum of per-question times — used
  // only when no start stamp survived, so the headline never silently blanks out.
  let totalTimeMs: number | null = null;
  let totalTimeSource: "quiz-start" | "sum-of-questions" | null = null;
  if (session.quizStartedAt) {
    const start = Date.parse(session.quizStartedAt);
    if (!Number.isNaN(start)) {
      const answeredAt = Object.values(session.answers)
        .map((a) => (a.answeredAt ? Date.parse(a.answeredAt) : Number.NaN))
        .filter((t) => !Number.isNaN(t));
      const fallback = answeredAt.length > 0 ? Math.max(...answeredAt) : Number.NaN;
      const end = session.completedAt ? Date.parse(session.completedAt) : fallback;
      if (!Number.isNaN(end) && end > start) {
        totalTimeMs = end - start;
        totalTimeSource = "quiz-start";
      }
    }
  }
  if (totalTimeMs === null && timedRows.length > 0) {
    totalTimeMs = timedRows.reduce((acc, t) => acc + t.durationMs, 0);
    totalTimeSource = "sum-of-questions";
  }

  // Allotted budget: per-tech mode gets the allowance once per served section of
  // contiguous same-technology questions, aggregated by technology — the quiz
  // page restarts the countdown on every technology change, so a section is what
  // actually got its own allowance. Empty outside per-tech mode, which leaves
  // global (one allowance for the whole set) and none (no limit) untouched.
  const perTechAllotment: { technology: string; allottedMs: number }[] = [];
  if (s.timingMode === "per-tech" && s.timeoutMinutes) {
    const sectionMs = s.timeoutMinutes * 60_000;
    const byTech = new Map<string, { technology: string; allottedMs: number }>();
    let previousTech: string | null = null;
    for (const r of rows) {
      const startsNewSection = r.q.technology !== previousTech;
      previousTech = r.q.technology;
      if (!startsNewSection) continue;
      const entry = byTech.get(r.q.technology);
      if (entry) {
        // A technology served in two separate runs got one allowance per run.
        entry.allottedMs += sectionMs;
      } else {
        byTech.set(r.q.technology, { technology: r.q.technology, allottedMs: sectionMs });
      }
    }
    perTechAllotment.push(...byTech.values());
  }

  const budgetMs =
    s.timingMode === "none" || !s.timeoutMinutes
      ? null
      : s.timingMode === "per-tech"
        ? perTechAllotment.reduce((acc, t) => acc + t.allottedMs, 0) || Math.max(1, s.technologies.length) * s.timeoutMinutes * 60_000
        : s.timeoutMinutes * 60_000;

  const slowest = timedRows.reduce<{ index: number; durationMs: number } | null>(
    (acc, t) => (acc === null || t.durationMs > acc.durationMs ? { index: t.index, durationMs: t.durationMs } : acc),
    null,
  );
  const fastest = timedRows.reduce<{ index: number; durationMs: number } | null>(
    (acc, t) => (acc === null || t.durationMs < acc.durationMs ? { index: t.index, durationMs: t.durationMs } : acc),
    null,
  );
  const showTiming = totalTimeMs !== null || timedRows.length > 0;

  // Wrong answers first, original order preserved within each group.
  const orderedRows = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.isCorrect === b.r.isCorrect ? a.i - b.i : a.r.isCorrect ? 1 : -1));

  // "Retry same set" re-runs the same questions. The server has to clear the
  // previous attempt *before* we navigate: a fully-answered session makes the quiz
  // page treat itself as finished and redirect straight back here, which is what
  // made this button a no-op loop.
  const retrySameSet = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetAnswers: true }),
      });
      if (!res.ok) throw new Error("retry rejected");
      router.push(`/quiz/${sessionId}`);
    } catch {
      setRetryError("Could not restart this set — please try again.");
      setRetrying(false);
    }
  };

  const buildExport = () => ({
    exportedAt: new Date().toISOString(),
    sessionId,
    status: session.status,
    attempt,
    selections: s,
    timestamps: {
      createdAt: session.createdAt,
      generatedAt: session.generatedAt,
      quizStartedAt: session.quizStartedAt,
      completedAt: session.completedAt,
    },
    score: { correct: correctCount, answered: answeredCount, total: questions.length, percent: pct },
    timing: {
      mode: s.timingMode,
      timeoutMinutes: s.timeoutMinutes,
      budgetMs,
      allottedByTechnology: perTechAllotment.map((t) => ({ technology: t.technology, allottedMs: t.allottedMs })),
      totalTimeMs,
      totalTimeSource,
      perQuestionMs: rows.map((r, i) => ({ questionIndex: i, durationMs: r.durationMs ?? null })),
    },
    questions: rows.map((r, i) => ({
      questionIndex: i,
      technology: r.q.technology,
      area: r.q.area,
      question: r.q.question,
      isMultiSelect: r.q.isMultiSelect,
      options: r.q.options,
      correctIndexes: r.q.correctIndexes,
      explanation: r.q.explanation,
      answered: r.answered,
      selectedIndexes: r.selected,
      isCorrect: r.isCorrect,
      durationMs: r.durationMs ?? null,
      answeredAt: session.answers[i]?.answeredAt ?? null,
    })),
    chats: session.chats ?? {},
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/" className="btn btn-xs btn-ghost -ml-2">
              ← Back to welcome
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">Results</h1>
            <SessionBadge sessionId={sessionId} />
          </div>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {s.difficulty} · {s.jobTitle}
            {attempt > 1 ? ` · attempt ${attempt}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-stretch gap-3">
          <div className="rounded-2xl border border-zinc-200 px-5 py-3 text-center dark:border-zinc-800">
            <div className="text-3xl font-semibold">{pct}%</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {correctCount}/{questions.length} correct ({answeredCount} answered)
            </div>
            {totalTimeMs !== null && (
              <div className="mt-2 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <div className="font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  {formatDuration(totalTimeMs)}
                </div>
                <div>time taken</div>
                {totalTimeSource === "sum-of-questions" && timedRows.length < rows.length && (
                  <div className="mt-0.5 text-[0.6875rem] text-zinc-400 dark:text-zinc-500">
                    sum of {timedRows.length}/{rows.length} measured
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => downloadJson(`mcq-session-${sessionId}.json`, buildExport())}
            className="btn btn-sm btn-secondary self-center"
          >
            Download session (JSON)
          </button>
        </div>
      </header>

      {showTiming && (
        <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Time taken</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-2.5 text-sm dark:bg-zinc-900">
              <span className="text-zinc-600 dark:text-zinc-400">Total</span>
              <span className="font-mono font-medium">
                {totalTimeMs !== null ? formatDuration(totalTimeMs) : "—"}
              </span>
            </div>
            {perTechAllotment.length > 1 ? (
              // Per-tech timing: the total stays on the header line, and the
              // technology × time formula it came from is spelled out below.
              <div className="flex flex-col gap-1.5 rounded-xl bg-zinc-50 px-4 py-2.5 text-sm dark:bg-zinc-900">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-600 dark:text-zinc-400">Allotted</span>
                  <span className="font-mono font-medium">
                    {budgetMs !== null ? formatDuration(budgetMs) : "no limit"}
                  </span>
                </div>
                <ul className="flex flex-col gap-0.5 border-t border-zinc-200 pt-1.5 text-xs dark:border-zinc-800">
                  {perTechAllotment.map((t) => (
                    <li key={t.technology} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">{t.technology}</span>
                      <span className="font-mono text-zinc-600 dark:text-zinc-300">{formatDuration(t.allottedMs)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-2.5 text-sm dark:bg-zinc-900">
                <span className="text-zinc-600 dark:text-zinc-400">Allotted</span>
                <span className="font-mono font-medium">
                  {budgetMs !== null ? formatDuration(budgetMs) : "no limit"}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-2.5 text-sm dark:bg-zinc-900">
              <span className="text-zinc-600 dark:text-zinc-400">Measured</span>
              <span className="font-mono font-medium">
                {timedRows.length}/{rows.length} questions
              </span>
            </div>
          </div>
          {slowest && fastest && (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Fastest: Q{fastest.index + 1} ({formatDuration(fastest.durationMs)}) · Slowest: Q{slowest.index + 1} (
              {formatDuration(slowest.durationMs)})
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Score by technology</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(perTech).map(([tech, v]) => (
            <div key={tech} className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-2.5 text-sm dark:bg-zinc-900">
              <span className="font-medium">{tech}</span>
              <span className="font-mono text-zinc-500 dark:text-zinc-400">
                {v.correct}/{v.total}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Technology / Area</th>
              <th className="px-4 py-3 font-medium">Question</th>
              <th className="px-4 py-3 font-medium">Your answer</th>
              <th className="px-4 py-3 font-medium">Correct</th>
              {timedRows.length > 0 && <th className="px-4 py-3 font-medium">Time</th>}
              <th className="px-4 py-3 text-right font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="px-4 py-3 font-mono text-zinc-500">{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.q.technology}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.q.area}</div>
                </td>
                <td className="max-w-xs px-4 py-3">
                  {r.q.question}
                  {r.q.isMultiSelect && (
                    <span className="ml-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      multi
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {!r.answered ? (
                    <span className="text-zinc-400">—</span>
                  ) : r.q.isMultiSelect ? (
                    <div className="flex flex-col gap-1">
                      {r.options
                        .filter((o) => o.state !== "ignored")
                        .map((o) => (
                          <span key={o.index} className="flex items-start gap-1.5">
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${MARKER_CHIP[o.state]}`}
                            >
                              {o.label} {OPTION_STATE[o.state].glyph}
                            </span>
                            <span className="min-w-0 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                              {o.state === "correct-missed"
                                ? "missed"
                                : o.state === "wrong-picked"
                                  ? "not correct"
                                  : "correct"}
                            </span>
                          </span>
                        ))}
                    </div>
                  ) : (
                    // Single-select: only what was picked. The correct option is
                    // already named in the "Correct" column, so repeating it here
                    // as an amber "you missed this" row would be noise.
                    <div className="flex flex-col gap-1">
                      {r.options
                        .filter((o) => o.state === "correct-picked" || o.state === "wrong-picked")
                        .map((o) => (
                          <span key={o.index} className={`text-xs leading-snug ${OPTION_STATE[o.state].text}`}>
                            <span className="font-semibold">
                              {o.label} {OPTION_STATE[o.state].glyph}
                            </span>{" "}
                            {o.text}
                          </span>
                        ))}
                    </div>
                  )}
                </td>
                <td className="max-w-xs px-4 py-3">
                  {/* The right answer, using the raw verdict (not displayState):
                      single-select names it plainly in green, while multi-select
                      keeps the amber "⊘" so a partial catch stays readable. */}
                  <div className="flex flex-col gap-1">
                    {r.options
                      .filter((o) => o.state === "correct-picked" || o.state === "correct-missed")
                      .map((o) => (
                        <span
                          key={o.index}
                          className={`text-xs leading-snug ${
                            r.q.isMultiSelect ? OPTION_STATE[o.state].text : OPTION_STATE["correct-picked"].text
                          }`}
                        >
                          <span className="font-semibold">
                            {o.label}
                            {r.q.isMultiSelect ? ` ${OPTION_STATE[o.state].glyph}` : ""}
                          </span>{" "}
                          {o.text}
                        </span>
                      ))}
                  </div>
                </td>
                {timedRows.length > 0 && (
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {r.durationMs !== undefined ? formatDuration(r.durationMs) : "—"}
                  </td>
                )}
                <td className="px-4 py-3 text-right font-semibold">
                  {!r.answered ? (
                    <span className="text-zinc-400">unanswered</span>
                  ) : r.isCorrect ? (
                    <span className="text-emerald-600 dark:text-emerald-400">✅</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">❌</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Explanations</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <span aria-hidden className="font-semibold">✓</span> correct &amp; picked
              </span>
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <span aria-hidden className="font-semibold">⊘</span> correct &amp; missed
              </span>
              <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                <span aria-hidden className="font-semibold">✗</span> picked, not correct
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAllExplanations(true)} className="btn btn-xs btn-secondary">
              Expand all
            </button>
            <button type="button" onClick={() => setAllExplanations(false)} className="btn btn-xs btn-secondary">
              Collapse all
            </button>
          </div>
        </div>

        <div ref={explanationsRef} className="flex flex-col gap-3">
          {orderedRows.map(({ r, i }) => (
            <details key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-zinc-400">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{r.q.question}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                      {r.q.technology} · {r.q.area}
                      {r.q.isMultiSelect ? " · multi" : ""}
                      {r.durationMs !== undefined ? ` · ${formatDuration(r.durationMs)}` : ""}
                    </span>
                  </span>
                  {!r.answered ? (
                    <span className="shrink-0 text-xs text-zinc-400">unanswered</span>
                  ) : r.isCorrect ? (
                    <span className="shrink-0 text-emerald-600 dark:text-emerald-400">✅</span>
                  ) : (
                    <span className="shrink-0 text-red-600 dark:text-red-400">❌</span>
                  )}
                </div>
              </summary>

              <div className="border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
                {/* All options shown: the explanation is written against the full
                    option list, so every letter it references has to resolve. For
                    single-select the correct option is not marked as "missed" here —
                    the "Correct answer:" line below names it. */}
                <div className="flex flex-col gap-1.5">
                  {r.options.map((o) => {
                    const style = OPTION_STATE[displayState(r.q, o.state)];
                    return (
                      <div key={o.index} className="flex items-start gap-2.5">
                        <span className="w-16 shrink-0 pt-px font-mono text-xs font-semibold uppercase text-zinc-400">
                          {o.label}
                        </span>
                        <span className={`min-w-0 flex-1 ${style.text}`}>
                          <QuestionText>{o.text}</QuestionText>
                        </span>
                        {style.glyph && (
                          <span className={`shrink-0 pt-px text-xs font-medium ${style.text}`}>
                            <span aria-hidden>{style.glyph}</span> {style.label.replace(/^[✓⊘✗]\s*/, "")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Correct answer{questionCorrectPlural(r.q)}:
                  </span>{" "}
                  {r.options
                    .filter((o) => o.state === "correct-picked" || o.state === "correct-missed")
                    .map((o) => `${o.label}) ${o.text}`)
                    .join("  ·  ")}
                </p>

                <div className="mt-2">
                  <QuestionText className="text-zinc-600 dark:text-zinc-400">{r.q.explanation}</QuestionText>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => downloadJson(`mcq-session-${sessionId}.json`, buildExport())}
          className="btn btn-md btn-secondary"
        >
          Download session (JSON)
        </button>
        <button
          type="button"
          onClick={() => void retrySameSet()}
          disabled={retrying}
          className="btn btn-md btn-secondary"
        >
          {retrying ? "Restarting…" : "Retry same set"}
        </button>
        <Link href="/" className="btn btn-md btn-primary">
          Generate a new set →
        </Link>
      </div>

      {retryError && <p className="text-xs text-red-600 dark:text-red-400">{retryError}</p>}
    </main>
  );
}

function questionCorrectPlural(q: GenerationQuestion): string {
  return q.correctIndexes.length > 1 ? "s" : "";
}

/**
 * The "you missed this" marker on the correct option is suppressed for
 * single-select questions: there is exactly one right answer and it is already
 * named in the recap's "Correct" column and the explanation's "Correct answer:"
 * line, so the amber "⊘ missed" marker would just repeat it. Multi-select keeps
 * it — there the candidate can catch some correct options and miss others, so
 * the marker carries real information.
 */
function displayState(q: GenerationQuestion, state: OptionState): OptionState {
  return state === "correct-missed" && !q.isMultiSelect ? "ignored" : state;
}