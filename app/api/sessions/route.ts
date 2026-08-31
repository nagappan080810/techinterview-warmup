import { NextResponse } from "next/server";
import { startGeneration } from "@/lib/generator";
import { createSession, listSessions } from "@/lib/sessions";
import { TECHNOLOGIES } from "@/lib/technologies";
import type { Difficulty, JobTitle, QuizSelections, RevealMode, TimingMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Mixed"];
const JOB_TITLES: JobTitle[] = ["Junior Developer", "Mid-level Developer", "Senior Developer", "Lead", "Architect"];
const TIMING_MODES: TimingMode[] = ["none", "per-tech", "global"];
const REVEAL_MODES: RevealMode[] = ["immediate", "end"];

function parseBody(body: unknown): { ok: true; selections: QuizSelections } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request body." };
  const b = body as Record<string, unknown>;

  const technologiesRaw = b.technologies;
  if (!Array.isArray(technologiesRaw) || technologiesRaw.length === 0) {
    return { ok: false, error: "Select at least one technology." };
  }
  const technologies = technologiesRaw.map((t) => String(t));
  const known = new Set(TECHNOLOGIES.map((t) => t.id));
  if (technologies.some((t) => !known.has(t))) {
    return { ok: false, error: "One or more technologies are not recognized." };
  }

  const difficulty = b.difficulty as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) return { ok: false, error: "Invalid difficulty." };

  const jobTitle = b.jobTitle as JobTitle;
  if (!JOB_TITLES.includes(jobTitle)) return { ok: false, error: "Invalid job title." };

  const questionsPerTech = Number(b.questionsPerTech);
  if (!Number.isInteger(questionsPerTech) || questionsPerTech < 1 || questionsPerTech > 20) {
    return { ok: false, error: "Questions per technology must be an integer between 1 and 20." };
  }

  const timingMode = b.timingMode as TimingMode;
  if (!TIMING_MODES.includes(timingMode)) return { ok: false, error: "Invalid timing mode." };

  const timeoutMinutes = Number(b.timeoutMinutes ?? 0);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 0 || timeoutMinutes > 180) {
    return { ok: false, error: "Timeout minutes must be between 0 and 180." };
  }

  const revealMode = b.revealMode as RevealMode;
  if (!REVEAL_MODES.includes(revealMode)) return { ok: false, error: "Invalid reveal mode." };

  const extraSpecifications = typeof b.extraSpecifications === "string" ? b.extraSpecifications.trim() : undefined;

  return {
    ok: true,
    selections: {
      technologies,
      difficulty,
      jobTitle,
      questionsPerTech,
      timingMode,
      timeoutMinutes,
      revealMode,
      extraSpecifications: extraSpecifications || undefined,
    },
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const session = await createSession(parsed.selections);
  await startGeneration(session.id, parsed.selections);

  return NextResponse.json({ id: session.id, status: session.status });
}

export async function GET() {
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}