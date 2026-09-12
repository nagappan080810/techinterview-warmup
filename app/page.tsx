"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIFFICULTIES, JOB_TITLES, TECHNOLOGIES } from "@/lib/technologies";
import type { Difficulty, JobTitle, RevealMode, TimingMode } from "@/lib/types";

export default function WelcomePage() {
  const router = useRouter();
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [jobTitle, setJobTitle] = useState<JobTitle>("Senior-Developer");
  const [questionsPerTech, setQuestionsPerTech] = useState(4);
  const [timingMode, setTimingMode] = useState<TimingMode>("none");
  const [timeoutMinutes, setTimeoutMinutes] = useState(4);
  const [revealMode, setRevealMode] = useState<RevealMode>("immediate");
  const [extraSpecifications, setExtraSpecifications] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggleTechnology = (id: string) => {
    setTechnologies((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const startGeneration = async () => {
    if (technologies.length === 0) {
      setError("Select at least one technology.");
      return;
    }
    setError(null);

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
        setError(data.error ?? "Failed to create session.");
        return;
      }

      // Always jump straight to the quiz page — it shows a "Waiting…"
      // spinner while generation runs and the "Ready when you are" intro
      // the moment questions are ready.
      router.push(`/quiz/${data.id}`);
    } catch {
      setError("Network error while starting generation.");
    }
  };

  const totalQuestions = technologies.length * questionsPerTech;

  return (
    <>
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 overflow-hidden px-6 py-6">
      <header className="shrink-0">
        <h1 className="text-3xl font-semibold tracking-tight">MCQ Interview Drill</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Pick your stack and settings. The generator agent creates a fresh, non-repeating question set just for you.
        </p>
      </header>

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
    </main>
    <footer className="shrink-0 border-t border-zinc-200 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      Any issues / suggestions — contact:{" "}
      <a href="mailto:nagappan08@gmail.com" className="underline hover:text-zinc-800 dark:hover:text-zinc-200">
        nagappan08@gmail.com
      </a>
    </footer>
    </>
  );
}
