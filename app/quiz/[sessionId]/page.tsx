"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GenerationQuestion, QuizSession, ChatMessage } from "@/lib/types";
import SessionBadge from "@/app/components/SessionBadge";
import QuestionText from "@/app/components/QuestionText";

type QuizStage = "loading" | "intro" | "question";

const OPTION_LABELS = ["A", "B", "C", "D"];

const ASK_TIMEOUT_MS = 105_000;

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
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [optimistic, setOptimistic] = useState<ChatMessage | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Displayed thread = persisted messages for the current question + the
  // in-flight (optimistic) message while the assistant is replying.
  const chatThread = useMemo<ChatMessage[]>(() => {
    const base = session?.chats?.[index] ?? [];
    return optimistic ? [...base, optimistic] : base;
  }, [session?.chats, index, optimistic]);

  const questions = useMemo<GenerationQuestion[]>(() => session?.questions ?? [], [session?.questions]);
  const question = questions[index];
  const total = questions.length;
  const immediate = session?.selections.revealMode === "immediate";
  const timingMode = session?.selections.timingMode;
  const timeoutMinutes = session?.selections.timeoutMinutes;

  // Stream generation progress via SSE instead of polling.
  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connect = () => {
      eventSource = new EventSource(`/api/sessions/${sessionId}/stream`);

      eventSource.addEventListener("status", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as {
          status: string;
          eventCount: number;
          questions?: GenerationQuestion[];
          selections?: QuizSession["selections"];
          answers?: QuizSession["answers"];
          chats?: QuizSession["chats"];
          error?: string;
        };
        setSession((prev) => {
          const base: QuizSession = prev ?? {
            id: sessionId,
            selections: data.selections ?? { technologies: [], difficulty: "Medium", jobTitle: "Senior Developer", questionsPerTech: 1, timingMode: "none", timeoutMinutes: 4, revealMode: "end" },
            status: "generating",
            createdAt: new Date().toISOString(),
            eventCount: 0,
            answers: {},
          };
          return {
            ...base,
            status: data.status as QuizSession["status"],
            eventCount: data.eventCount,
            questions: data.questions ?? base.questions,
            selections: data.selections ?? base.selections,
            answers: data.answers ?? base.answers,
            chats: data.chats ?? base.chats,
            error: data.error ?? base.error,
          };
        });
        if (data.status === "complete") {
          setStage((prev) => (prev === "loading" ? "intro" : prev));
        } else if (data.status === "error") {
          setError(data.error ?? "Generation failed.");
        }
      });

      eventSource.addEventListener("progress", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { eventCount: number; lastEventAt?: string };
        setSession((prev) => {
          if (!prev) return prev;
          return { ...prev, eventCount: data.eventCount, lastEventAt: data.lastEventAt };
        });
      });

      eventSource.addEventListener("complete", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as {
          status: string;
          questions: GenerationQuestion[];
          selections?: QuizSession["selections"];
          answers?: QuizSession["answers"];
          chats?: QuizSession["chats"];
          eventCount: number;
        };
        setSession((prev) => {
          const base: QuizSession = prev ?? {
            id: sessionId,
            selections: data.selections ?? { technologies: [], difficulty: "Medium", jobTitle: "Senior Developer", questionsPerTech: 1, timingMode: "none", timeoutMinutes: 4, revealMode: "end" },
            status: "complete",
            createdAt: new Date().toISOString(),
            eventCount: 0,
            answers: {},
          };
          return {
            ...base,
            status: "complete",
            questions: data.questions,
            selections: data.selections ?? base.selections,
            answers: data.answers ?? base.answers,
            chats: data.chats ?? base.chats,
            eventCount: data.eventCount,
            completedAt: new Date().toISOString(),
          };
        });
        setStage((prev) => (prev === "loading" ? "intro" : prev));
      });

      eventSource.addEventListener("error", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { error: string };
          setError(data.error ?? "Generation failed.");
        } catch {
          // SSE connection error (not a data error)
        }
      });

      eventSource.addEventListener("done", () => {
        eventSource?.close();
        eventSource = null;
      });

      let reconnectAttempts = 0;
      const MAX_RECONNECTS = 15;

      eventSource.onerror = () => {
        // Connection lost — fallback to a single poll, then reconnect
        eventSource?.close();
        eventSource = null;
        void fetch(`/api/sessions/${sessionId}`)
          .then(async (r) => {
            if (r.status === 404) {
              setError("This session no longer exists (the server likely restarted). Please start a new set.");
              return;
            }
            const d = (await r.json()) as { session?: QuizSession; error?: string };
            const s = d.session;
            if (!s) {
              setError(d.error ?? "Could not load this session. Please start a new set.");
              return;
            }
            setSession(s);
            if (s.status === "complete") {
              setStage((prev) => (prev === "loading" ? "intro" : prev));
            } else if (s.status === "error") {
              setError(s.error ?? "Generation failed.");
            } else if (reconnectAttempts >= MAX_RECONNECTS) {
              setError("Generation is taking too long. It may be stuck — please start a new set.");
            } else {
              reconnectAttempts += 1;
              // Reconnect after a brief delay
              setTimeout(connect, 2000);
            }
          })
          .catch(() => {
            if (reconnectAttempts >= MAX_RECONNECTS) {
              setError("Could not reach the server. Please refresh and start a new set.");
            } else {
              reconnectAttempts += 1;
              setTimeout(connect, 2000);
            }
          });
      };
    };

    connect();

    return () => {
      eventSource?.close();
    };
  }, [sessionId]);

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
    setChatOpen(false);
    setChatInput("");
    setOptimistic(null);
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

  const askQuestion = async (preset?: string) => {
    if (!question || chatLoading) return;
    const message = (preset ?? chatInput).trim();
    if (!message) return;
    const userMsg: ChatMessage = { role: "user", content: message, createdAt: new Date().toISOString() };
    setChatInput("");
    setChatLoading(true);
    setOptimistic(userMsg);
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIndex: index, message }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { ok?: boolean; thread?: ChatMessage[]; error?: string };
      const assistant: ChatMessage =
        res.ok && data.thread
          ? data.thread[data.thread.length - 1]
          : { role: "assistant", content: `⚠️ ${data.error ?? "Something went wrong."}`, createdAt: new Date().toISOString() };
      setSession((prev) => (prev ? { ...prev, chats: { ...(prev.chats ?? {}), [index]: [...(prev.chats?.[index] ?? []), userMsg, assistant] } } : prev));
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setSession((prev) =>
        prev
          ? {
              ...prev,
              chats: {
                ...(prev.chats ?? {}),
                [index]: [
                  ...(prev.chats?.[index] ?? []),
                  userMsg,
                  {
                    role: "assistant",
                    content: timedOut
                      ? "⚠️ The assistant took too long to respond. Please try your question again."
                      : "⚠️ Could not reach the assistant.",
                    createdAt: new Date().toISOString(),
                  },
                ],
              },
            }
          : prev,
      );
    } finally {
      clearTimeout(abortTimer);
      setOptimistic(null);
      setChatLoading(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatThread, chatOpen]);

  const next = async () => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIndex: index, selectedIndexes: selected }),
      });
    } catch {
      // non-fatal
    }
    const nextIndex = index + 1;
    if (nextIndex < total) {
      if (timingMode === "per-tech" && questions[nextIndex]?.technology !== question?.technology) {
        setSectionStart(Date.now());
      }
      setSelected([]);
      setRevealed(false);
      setChatOpen(false);
      setChatInput("");
      setOptimistic(null);
      setIndex(nextIndex);
      return;
    }
    router.push(`/results/${sessionId}`);
  };

  const askPreset = (label: string) => () => void askQuestion(label);

  const timeLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (stage === "loading") {
    // A fatal error (session gone, timeout, unreachable server) should show an
    // escape hatch instead of a spinner that never resolves.
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
        <div className="flex w-full items-center justify-between gap-3">
          <button onClick={() => router.push("/")} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            ← New set
          </button>
          <SessionBadge sessionId={sessionId} />
        </div>
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          Question {index + 1} of {total}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs">
            {question.technology} · {question.area} · {question.isMultiSelect ? "multi" : "single"}
          </span>
          {timerActive && (
            <span className={timeLeft <= 30 ? "font-mono font-semibold text-red-600 dark:text-red-400" : "font-mono"}>{formatTime(timeLeft)}</span>
          )}
          <SessionBadge sessionId={sessionId} />
        </div>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      <section className="flex flex-col gap-6 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <div>
          <QuestionText className="text-xl font-semibold leading-snug">{question.question}</QuestionText>
          {question.isMultiSelect && (
            <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-wide text-zinc-400">Select ALL that apply</span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {question.options.map((opt, i) => {
            const chosen = selected.includes(i);
            const correctOpt = question.correctIndexes.includes(i);
            let stateClass = "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600";
            if (revealed) {
              if (correctOpt) stateClass = "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40";
              else if (chosen) stateClass = "border-red-500 bg-red-50 dark:bg-red-950/40";
            } else if (chosen) {
              stateClass = "border-amber-500 bg-amber-200 dark:border-amber-400 dark:bg-amber-900/60";
            }
            return (
              <button
                key={i}
                type="button"
                disabled={revealed}
                onClick={() => toggleOption(i)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${stateClass}`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    !revealed && chosen
                      ? "border-amber-600 bg-amber-500 text-white dark:border-amber-500 dark:bg-amber-400 dark:text-zinc-900"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                >
                  {OPTION_LABELS[i]}
                </span>
                <span className="min-w-0 flex-1"><QuestionText>{opt}</QuestionText></span>
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
            <QuestionText className="text-zinc-600 dark:text-zinc-400">{question.explanation}</QuestionText>
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

        <div className="mt-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setChatOpen((o) => !o)}
            className="flex w-full items-center justify-between text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            <span>💬 Ask a question about this question</span>
            <span className="text-xs text-zinc-400">{chatOpen ? "Hide ▲" : "Show ▼"}</span>
          </button>

          {chatOpen && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={askPreset("Why is each option wrong or right?")}
                  disabled={chatLoading}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-400 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Why is each option wrong/right?
                </button>
                <button
                  type="button"
                  onClick={askPreset("Explain this concept simply, with a short example.")}
                  disabled={chatLoading}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-400 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Explain simply
                </button>
              </div>

              <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/60">
                {chatThread.length === 0 && (
                  <p className="text-center text-xs text-zinc-400">Ask anything about this question — the assistant will help.</p>
                )}
                {chatThread.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                        m.role === "user"
                          ? "whitespace-pre-wrap bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {m.role === "assistant" ? (
                        <QuestionText>{m.content}</QuestionText>
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                      …
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void askQuestion();
                    }
                  }}
                  placeholder="Type your question…"
                  disabled={chatLoading}
                  className="min-w-0 flex-1 rounded-full border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => void askQuestion()}
                  disabled={chatLoading || chatInput.trim().length === 0}
                  className="shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}