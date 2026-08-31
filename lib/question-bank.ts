import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BankedQuestion, GenerationQuestion, QuizSelections } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const BANK_FILE = path.join(DATA_DIR, "question-bank.json");

interface QuestionBank {
  questions: BankedQuestion[];
}

async function readBank(): Promise<QuestionBank> {
  try {
    const raw = await readFile(BANK_FILE, "utf8");
    return JSON.parse(raw) as QuestionBank;
  } catch {
    return { questions: [] };
  }
}

async function writeBank(bank: QuestionBank): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(BANK_FILE, JSON.stringify(bank, null, 2), "utf8");
}

/** Return already-existing question texts for the selected technologies/areas, so the generator can avoid repeating them. */
export async function getExistingQuestions(
  selections: QuizSelections,
  generatedNow: GenerationQuestion[],
): Promise<Array<{ question: string; technology: string; area: string }>> {
  const bank = await readBank();
  const freshKeys = new Set(
    generatedNow.map((q) => `${q.technology.toLowerCase()}::${q.question.toLowerCase().trim()}`),
  );
  const used = bank.questions.filter((q) => {
    if (!selections.technologies.includes(q.technology)) return false;
    const key = `${q.technology.toLowerCase()}::${q.question.toLowerCase().trim()}`;
    return !freshKeys.has(key);
  });
  return used.map((q) => ({ question: q.question, technology: q.technology, area: q.area }));
}

/** Append freshly generated questions to the bank, tagging them with run metadata. */
export async function appendToBank(
  questions: GenerationQuestion[],
  sessionId: string,
  selections: QuizSelections,
): Promise<void> {
  const bank = await readBank();
  const existingKeys = new Set(
    bank.questions.map((q) => `${q.technology.toLowerCase()}::${q.question.toLowerCase().trim()}`),
  );
  const now = new Date().toISOString();
  for (const q of questions) {
    const key = `${q.technology.toLowerCase()}::${q.question.toLowerCase().trim()}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const entry: BankedQuestion = {
      ...q,
      id: crypto.randomUUID(),
      sessionId,
      difficulty: selections.difficulty,
      jobTitle: selections.jobTitle,
      createdAt: now,
      usedCount: 1,
    };
    bank.questions.push(entry);
  }
  await writeBank(bank);
}

/** Count banked questions per technology (useful for UI / stats). */
export async function bankStats(): Promise<Array<{ technology: string; count: number }>> {
  const bank = await readBank();
  const map = new Map<string, number>();
  for (const q of bank.questions) {
    map.set(q.technology, (map.get(q.technology) ?? 0) + 1);
  }
  return [...map.entries()].map(([technology, count]) => ({ technology, count })).sort((a, b) => b.count - a.count);
}