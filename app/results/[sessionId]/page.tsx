"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { GenerationQuestion, QuizSession } from "@/lib/types";
import SessionBadge from "@/app/components/SessionBadge";

const OPTION_LABELS = ["A", "B", "C", "D"];

interface Row {
  q: GenerationQuestion;
  selected: number[];
  isCorrect: boolean;
  answered: boolean;
}

export default function ResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<QuizSession | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error || (session && session.status !== "complete")) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-6 py-24 text-center">
        <div>
          <p className="mb-4 text-red-600 dark:text-red-400">{error ?? "This quiz never completed generation."}</p>
          <Link href="/" className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium dark:border-zinc-700">
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
    return { q, selected, isCorrect, answered };
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

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Results</h1>
            <SessionBadge sessionId={sessionId} />
          </div>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {s.difficulty} · {s.jobTitle}
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-200 px-5 py-3 text-center dark:border-zinc-800">
          <div className="text-3xl font-semibold">{pct}%</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {correctCount}/{questions.length} correct ({answeredCount} answered)
          </div>
        </div>
      </header>

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
                <td className="max-w-md px-4 py-3">
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
                  ) : (
                    <span>{r.selected.map((o) => OPTION_LABELS[o]).join(", ") || "—"}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400">
                  {r.q.correctIndexes.map((c) => OPTION_LABELS[c]).join(", ")}
                </td>
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

      <details className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">Show explanations</summary>
        <div className="mt-3 flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
              <p className="font-medium">{i + 1}. {r.q.question}</p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{r.q.explanation}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="flex flex-wrap justify-end gap-3">
        <Link href={`/quiz/${sessionId}`} className="rounded-full border border-zinc-300 px-6 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Retry same set
        </Link>
        <Link href="/" className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">
          Generate a new set →
        </Link>
      </div>
    </main>
  );
}