export type Difficulty = "Easy" | "Medium" | "Hard" | "Mixed";

export type JobTitle = "Junior Developer" | "Mid-level Developer" | "Senior Developer" | "Lead" | "Architect";

export type RevealMode = "immediate" | "end";

export type TimingMode = "none" | "per-tech" | "global";

export interface QuizSelections {
  technologies: string[];
  difficulty: Difficulty;
  jobTitle: JobTitle;
  questionsPerTech: number;
  timingMode: TimingMode;
  timeoutMinutes: number;
  revealMode: RevealMode;
}

export interface GenerationQuestion {
  technology: string;
  area: string;
  question: string;
  isMultiSelect: boolean;
  options: string[];
  correctIndexes: number[];
  explanation: string;
}

export interface BankedQuestion extends GenerationQuestion {
  id: string;
  sessionId: string;
  difficulty: Difficulty;
  jobTitle: JobTitle;
  createdAt: string;
  usedCount: number;
}

export interface QuestionAnswer {
  questionIndex: number;
  selectedIndexes: number[];
  isCorrect: boolean;
  answeredAt?: string;
}

export type SessionStatus = "queued" | "generating" | "complete" | "error";

export interface QuizSession {
  id: string;
  selections: QuizSelections;
  status: SessionStatus;
  createdAt: string;
  generatedAt?: string;
  completedAt?: string;
  error?: string;
  lastEventAt?: string;
  eventCount: number;
  questions?: GenerationQuestion[];
  answers: Record<number, QuestionAnswer>;
}

export interface QuestionStoreEntry {
  technology: string;
  area: string;
  difficulty: Difficulty;
  jobTitle: JobTitle;
  usedCount: number;
  createdAt: string;
}