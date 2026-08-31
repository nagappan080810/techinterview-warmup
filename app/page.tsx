"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DIFFICULTIES, JOB_TITLES, TECHNOLOGIES } from "@/lib/technologies";
import type { Difficulty, JobTitle, RevealMode, SessionStatus, TimingMode } from "@/lib/types";
import SessionBadge from "@/app/components/SessionBadge";

type Stage = "form" | "generating" | "error";

interface SessionStatusPayload {
  status: SessionStatus;
  eventCount: number;
  lastEventAt?: string;
  questions?: unknown[];
  error?: string;
}

export default function WelcomePage() {
  const router = useRouter();
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [jobTitle, setJobTitle] = useState<JobTitle>("Senior Developer");
  const [questionsPerTech, setQuestionsPerTech] = useState(4);
  const [timingMode, setTimingMode] = useState<TimingMode>("none");
  const [timeoutMinutes, setTimeoutMinutes] = useState(4);
  const [revealMode, setRevealMode] = useState<RevealMode>("immediate");
  const [extraSpecifications, setExtraSpecifications] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ eventCount: number; elapsed: number }>({ eventCount: 0, elapsed: 0 });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggleTechnology = (id: string) => {
    setTechnologies((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      // Handle both setInterval and EventSource cleanup
      if (typeof pollRef.current === "object" && "close" in pollRef.current) {
        (pollRef.current as { close: () => void }).close();
      } else {
        clearInterval(pollRef.current);
      }
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startGeneration = async () => {
    if (technologies.length === 0) {
      setError("Select at least one technology.");
      return;
    }
    setError(null);
    setStage("generating");
    setProgress({ eventCount: 0, elapsed: 0 });

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          technologies,
          difficulty,
          jobTitle,
          questionsPerTech,
          timingMode,
          timeoutMinutes,
          revealMode,
          extraSpecifications: extraSpecifications.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStage("error");
        setError(data.error ?? "Failed to create session.");
        return;
      }
      setSessionId(data.id);
      startSSE(data.id);
    } catch {
      setStage("error");
      setError("Network error while starting generation.");
    }
  };

  const startSSE = (id: string) => {
    stopPolling();
    const startTime = Date.now();

    const eventSource = new EventSource(`/api/sessions/${id}/stream`);

    eventSource.addEventListener("progress", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { eventCount: number };
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      setProgress({ eventCount: data.eventCount, elapsed });
    });

    eventSource.addEventListener("complete", () => {
      eventSource.close();
      setStage("form");
      router.push(`/quiz/${id}`);
    });

    eventSource.addEventListener("error", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { error: string };
        eventSource.close();
        setStage("error");
        setError(data.error ?? "Generation failed.");
      } catch {
        // SSE connection error
      }
    });

    eventSource.addEventListener("done", () => {
      eventSource.close();
    });

    eventSource.onerror = () => {
      eventSource.close();
      // Fallback: poll once to check status
      void fetch(`/api/sessions/${id}`)
        .then((r) => r.json())
        .then((d) => {
          const s = (d as { session: SessionStatusPayload }).session;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          setProgress({ eventCount: s.eventCount ?? 0, elapsed });
          if (s.status === "complete") {
            setStage("form");
            router.push(`/quiz/${id}`);
          } else if (s.status === "error") {
            setStage("error");
            setError(s.error ?? "Generation failed.");
          }
        })
        .catch(() => {});
    };

    // Store for cleanup
    pollRef.current = { close: () => eventSource.close() } as unknown as ReturnType<typeof setInterval>;
  };

  const reset = () => {
    stopPolling();
    setStage("form");
    setSessionId(null);
    setError(null);
  };

  const totalQuestions = technologies.length * questionsPerTech;

  return (
    <main className="mx-auto flex h-screen w-full max-w-6xl flex-col gap-5 overflow-hidden px-6 py-6">
      <header className="shrink-0">
        <h1 className="text-3xl font-semibold tracking-tight">MCQ Interview Drill</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Pick your stack and settings. The generator agent creates a fresh, non-repeating question set just for you.
        </p>
      </header>

      {stage !== "form" && (
        <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800 dark:border-zinc-700 dark:border-t-zinc-200" />
          <h2 className="text-lg font-medium">
            {sessionId ? "Agent is generating your questions…" : "Starting generation…"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {totalQuestions} questions across {technologies.length} technology
            {technologies.length > 1 ? "ies" : "y"} — this takes a few seconds.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {sessionId ? <SessionBadge sessionId={sessionId} /> : <span>session …</span>}
            <span>·</span>
            <span>{progress.eventCount} events</span>
            <span>·</span>
            <span>{progress.elapsed}s</span>
          </div>
          {stage === "error" && (
            <div className="mt-6">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
              <button onClick={reset} className="mt-4 rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                Back to form
              </button>
            </div>
          )}
        </section>
      )}

      {stage === "form" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void startGeneration();
          }}
          className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-2"
        >
          <div className="min-h-0 overflow-y-auto rounded-2xl border border-zinc-200 p-4 pr-3 dark:border-zinc-800">
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Technologies — select one or more</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {TECHNOLOGIES.map((tech) => {
                  const selected = technologies.includes(tech.id);
                  const open = expanded === tech.id;
                  return (
                    <div
                      key={tech.id}
                      className={`rounded-2xl border p-4 transition-colors ${
                        selected
                          ? "border-zinc-800 bg-zinc-100 dark:border-zinc-200 dark:bg-zinc-800"
                          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTechnology(tech.id)}
                        className="flex w-full items-start gap-3 text-left"
                      >
                        <span className={`mt-0.5 text-xl ${selected ? "" : "opacity-40 grayscale"}`}>{tech.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{tech.name}</span>
                          <span className="mt-0.5 block text-sm text-zinc-500 dark:text-zinc-400">{tech.shortDescription}</span>
                        </span>
                        <span
                          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                            selected ? "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-600"
                          }`}
                        >
                          {selected ? "✓" : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : tech.id)}
                        className="mt-2 text-xs font-medium text-zinc-400 underline-offset-2 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
                      >
                        {open ? "Hide areas" : "Show areas covered"}
                      </button>
                      {open && (
                        <ul className="mt-2 space-y-2 rounded-xl bg-white/60 p-3 text-sm dark:bg-black/30">
                          {tech.areas.map((a) => (
                            <li key={a.name}>
                              <span className="font-medium">{a.name}</span>
                              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{a.description}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto pr-2">
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Difficulty</legend>
              <div className="flex flex-wrap gap-2">
                {DIFFICULTIES.map((d) => (
                  <label
                    key={d}
                    className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      difficulty === d
                        ? "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
                        : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
                    }`}
                  >
                    <input type="radio" name="difficulty" value={d} checked={difficulty === d} onChange={() => setDifficulty(d)} className="sr-only" />
                    {d}
                  </label>
                ))}
              </div>
            </fieldset>

          <fieldset>
            <legend className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Job Title</legend>
            <div className="flex flex-wrap gap-2">
              {JOB_TITLES.map((j) => (
                <label
                  key={j}
                  className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    jobTitle === j
                      ? "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
                      : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
                  }`}
                >
                  <input type="radio" name="jobTitle" value={j} checked={jobTitle === j} onChange={() => setJobTitle(j)} className="sr-only" />
                  {j}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-6 sm:grid-cols-2">
            <div>
              <legend className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Questions per technology
              </legend>
              <input
                type="number"
                min={1}
                max={20}
                value={questionsPerTech}
                onChange={(e) => setQuestionsPerTech(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="w-full rounded-xl border border-zinc-300 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <p className="mt-1 text-xs text-zinc-500">Total: {totalQuestions} question{totalQuestions === 1 ? "" : "s"}</p>
            </div>

            <div>
              <legend className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Timer</legend>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["none", "No timer"],
                      ["per-tech", "Per technology"],
                      ["global", "Whole quiz"],
                    ] as Array<[TimingMode, string]>
                  ).map(([mode, label]) => (
                    <label
                      key={mode}
                      className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        timingMode === mode
                          ? "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
                          : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
                      }`}
                    >
                      <input type="radio" name="timing" value={mode} checked={timingMode === mode} onChange={() => setTimingMode(mode)} className="sr-only" />
                      {label}
                    </label>
                  ))}
                </div>
                {timingMode !== "none" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={timeoutMinutes}
                      onChange={(e) => setTimeoutMinutes(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                      className="w-24 rounded-xl border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <span className="text-xs text-zinc-500">
                      {timingMode === "per-tech" ? "minutes per technology section" : "total minutes"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Show answer</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["immediate", "Immediately after each answer"],
                  ["end", "At the end of the quiz"],
                ] as Array<[RevealMode, string]>
              ).map(([mode, label]) => (
                <label
                  key={mode}
                  className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    revealMode === mode
                      ? "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
                      : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
                  }`}
                >
                  <input type="radio" name="reveal" value={mode} checked={revealMode === mode} onChange={() => setRevealMode(mode)} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Immediate = right/wrong + explanation after each question. End = all answers scored at the finish.
            </p>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Extra specifications <span className="text-zinc-400">(optional)</span>
            </legend>
            <textarea
              value={extraSpecifications}
              onChange={(e) => setExtraSpecifications(e.target.value)}
              placeholder="e.g. Focus on production-ready patterns. Include questions about error handling, edge cases, and real-world scenarios."
              rows={3}
              className="w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Any additional instructions about the nature of questions you want.
            </p>
          </fieldset>

          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={technologies.length === 0}
            className="w-full rounded-full bg-zinc-900 px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Generate {totalQuestions} questions →
          </button>
          </div>
        </form>
      )}
    </main>
  );
}