"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GenerationQuestion, QuizSession } from "@/lib/types";

type QuizStage = "loading" | "intro" | "question";

const OPTION_LABELS = ["A", "B", "C", "D"];

export default function QuizPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();

  const [session, setSession] = useState<QuizSession | null>(null);
  const [stage, setStage] = useState<QuizStage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(0);
  const [quizStart, setQuizStart] = useState<number | null>(null);
  const [sectionStart, setSectionStart] = useState<number | null>(null);

  const questions = useMemo<GenerationQuestion[]>(() => session?.questions ?? [], [session?.questions]);
  const question = questions[index];
  const total = questions.length;
  const immediate = session?.selections.revealMode === "immediate";
  const timingMode = session?.selections.timingMode;
  const timeoutMinutes = session?.selections.timeoutMinutes;

  // Poll until the agent finishes generating the question set.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) {
          if (alive) setError("Could not load this quiz session.");
          return;
        }
        const data = (await res.json()) as { session: QuizSession };
        const s = data.session;
        if (!alive) return;
        setSession(s);
        if (s.status === "complete") {
          if (timer) clearInterval(timer);
          setStage("intro");
        } else if (s.status === "error") {
          if (timer) clearInterval(timer);
          setError(s.error ?? "Generation failed.");
        }
      } catch {
        // transient — keep polling
      }
    };

    void poll();
    if (stage !== "intro") {
      timer = setInterval(() => void poll(), 2000);
    }
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [sessionId, stage]);

  const timerActive = timingMode !== "none" && stage === "question" && question !== undefined;

  // Ticking clock while the timer is live.
  useEffect(() => {
    if (!timerActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerActive]);

  const remainingMs = useMemo(() => {
    if (!timerActive || quizStart === null) return Infinity;
    const mins = timeoutMinutes ?? 0;
    const base = timingMode === "per-tech" ? (sectionStart ?? quizStart) : quizStart;
    return base + mins * 60_000 - now;
  }, [timerActive, now, quizStart, sectionStart, timingMode, timeoutMinutes]);

  // Hard stop at the deadline (rapid-round style).
  const timeUpHandled = useRef(false);
  useEffect(() => {
    if (timerActive && remainingMs <= 0 && !timeUpHandled.current) {
      timeUpHandled.current = true;
      if (revealed) {
        router.push(`/results/${sessionId}`);
      } else {
        const selectedCopy = selected;
        void (async () => {
          try {
            await fetch(`/api/sessions/${sessionId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ questionIndex: index, selectedIndexes: selectedCopy }),
            });
          } catch {
            // non-fatal
          }
          router.push(`/results/${sessionId}`);
        })();
      }
    }
  }, [timerActive, remainingMs, revealed, selected, index, sessionId, router]);

  const startQuiz = async () => {
    timeUpHandled.current = false;
    setNow(Date.now());
    setQuizStart(Date.now());
    setSectionStart(Date.now());
    setIndex(0);
    setSelected([]);
    setRevealed(false);
    setStage("question");
    if (session && Object.keys(session.answers).length > 0) {
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resetAnswers: true }),
        });
      } catch {
        // ignore
      }
    }
  };

  const toggleOption = (opt: number) => {
    if (revealed) return;
    setSelected((prev) =>
      question?.isMultiSelect
        ? prev.includes(opt)
          ? prev.filter((o) => o !== opt)
          : [...prev, opt].sort()
        : [opt],
    );
  };

  const checkAnswer = async () => {
    if (!question) return;
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIndex: index, selectedIndexes: selected }),
      });
    } catch {
      // non-fatal
    }
    setRevealed(true);
  };

  const next = () => {
    const nextIndex = index + 1;
    if (nextIndex < total) {
      if (timingMode === "per-tech" && questions[nextIndex]?.technology !== question?.technology) {
        setSectionStart(Date.now());
      }
      setSelected([]);
      setRevealed(false);
      setIndex(nextIndex);
      return;
    }
    router.push(`/results/${sessionId}`);
  };

  const timeLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (stage === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800 dark:border-zinc-700 dark:border-t-zinc-200" />
        <p className="text-zinc-500 dark:text-zinc-400">Waiting for the agent to finish generating questions…</p>
        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      </main>
    );
  }

  if (error && !session) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <button onClick={() => router.push("/")} className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium dark:border-zinc-700">
          Back to welcome page
        </button>
      </main>
    );
  }

  if (stage === "intro" && session) {
    const s = session.selections;
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-8 px-6 py-16">
        <button onClick={() => router.push("/")} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← New set
        </button>
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Ready when you are</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            {total} questions · {s.difficulty} · {s.jobTitle}
            {timingMode !== "none" && (
              <> · {timingMode === "per-tech" ? `${s.timeoutMinutes} min per technology` : `${s.timeoutMinutes} min total`}</>
            )}
            {" · "}
            {immediate ? "answers revealed after each question" : "answers revealed at the end"}
          </p>
        </header>
        <ul className="flex flex-wrap gap-2">
          {questions.map((q, i) => (
            <li key={i} className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Q{i + 1} · {q.technology} · {q.area}
            </li>
          ))}
        </ul>
        <button
          onClick={() => void startQuiz()}
          className="rounded-full bg-zinc-900 px-8 py-3 font-medium text-white transition-opacity hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Start quiz →
        </button>
      </main>
    );
  }

  if (!question) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-6 py-24 text-center">
        <p>No questions in this session.</p>
      </main>
    );
  }

  const answerIsCorrect =
    selected.length === question.correctIndexes.length && [...question.correctIndexes].every((c) => selected.includes(c));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between gap-4 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          Question {index + 1} of {total}
        </span>
        <span className="font-mono text-xs">
          {question.technology} · {question.area} · {question.isMultiSelect ? "multi" : "single"}
        </span>
        {timerActive && (
          <span className={timeLeft <= 30 ? "font-mono font-semibold text-red-600 dark:text-red-400" : "font-mono"}>{formatTime(timeLeft)}</span>
        )}
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      <section className="flex flex-col gap-6 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-xl font-semibold leading-snug">
          {question.question}
          {question.isMultiSelect && (
            <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-wide text-zinc-400">Select ALL that apply</span>
          )}
        </h2>

        <div className="flex flex-col gap-3">
          {question.options.map((opt, i) => {
            const chosen = selected.includes(i);
            const correctOpt = question.correctIndexes.includes(i);
            let stateClass = "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600";
            if (revealed) {
              if (correctOpt) stateClass = "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40";
              else if (chosen) stateClass = "border-red-500 bg-red-50 dark:bg-red-950/40";
            } else if (chosen) {
              stateClass = "border-zinc-800 bg-zinc-100 dark:border-zinc-200 dark:bg-zinc-800";
            }
            return (
              <button
                key={i}
                type="button"
                disabled={revealed}
                onClick={() => toggleOption(i)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${stateClass}`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-xs font-semibold dark:border-zinc-600">
                  {OPTION_LABELS[i]}
                </span>
                <span className="min-w-0 flex-1">{opt}</span>
                {revealed && correctOpt && <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
                {revealed && chosen && !correctOpt && <span className="text-red-600 dark:text-red-400">✗</span>}
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className="rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
            <p className="mb-1 font-semibold">
              {answerIsCorrect ? "✅ Correct." : "❌ Incorrect."} Correct answer{question.correctIndexes.length > 1 ? "s" : ""}:{" "}
              {question.correctIndexes.map((c) => `${OPTION_LABELS[c]}) ${question.options[c]}`).join("  ·  ")}
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">{question.explanation}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          {!revealed && immediate && (
            <button
              onClick={() => void checkAnswer()}
              disabled={selected.length === 0}
              className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Check answer
            </button>
          )}
          {!revealed && !immediate && (
            <button
              onClick={() => void next()}
              className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {index + 1 === total ? "Finish →" : "Next →"}
            </button>
          )}
          {revealed && (
            <button
              onClick={() => void next()}
              className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {index + 1 === total ? "See results →" : "Next →"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}