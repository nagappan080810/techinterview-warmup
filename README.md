# MCQ Interview Drill

Agent-generated technical MCQ practice. Pick your stack, difficulty, job title, question count, timer, and answer-reveal style on the welcome page — a dedicated `mcq-generator` agent (headless opencode) generates a fresh, non-repeating question set, and you answer single/multi-select MCQs one at a time with per-technology scoring. On any individual question you can open an inline chat and ask the `mcq-clarify` agent a follow-up (e.g. "why is each option wrong?"), with the conversation persisted per question.

## Quick start

```bash
npm install
npm install -g opencode-ai   # embedded question-generator runtime (opencode serve)
npm run dev                  # http://localhost:3000
```

Question generation uses the [@opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk) embedded in the app. It spawns a background `opencode serve` and drives the `mcq-generator` agent (in `opencode.json`) to produce each question set, reading the JSON array back from the assistant response. The same server powers per-question clarifications via the `mcq-clarify` agent.

## Flow

1. **Welcome** — select technologies (areas expandable), difficulty, job title, questions-per-technology, timer, reveal mode.
2. **Generate** — `POST /api/sessions` spawns the agent in the background; progress (status + event count) is polled live.
3. **Quiz** — one question at a time with immediate or end-of-quiz answer reveal, optional per-tech/global countdown. Under each question, an "Ask a question about this question" panel starts a persisted chat with the `mcq-clarify` agent (`POST /api/sessions/[id]/ask`) for concept clarification and per-option explanations.
4. **Results** — score card, per-technology breakdown, full recap table and explanations.

Generated questions accumulate in `data/question-bank.json` tagged with technology/area/difficulty/job-title metadata; already-used questions are excluded from future sets.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) — learn about Next.js features and API.
- [opencode](https://opencode.ai) — the CLI + agent runtime used for generation.