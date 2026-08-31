# MCG Interview Drill (mcq-app)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

OpenCode workspace for an agent-generated MCQ practice app.

## Build & Run (Next.js 16, App Router, TypeScript + Tailwind)
```sh
npm run dev       # development
npm run build     # production build (typecheck + lint gated)
npm run start     # serve production build
npm run lint      # eslint (React Compiler rules — keep clean)
npx tsc --noEmit  # typecheck
```

## How it works
- **Welcome page** (`app/page.tsx`): multi-select technologies (with expandable area
  descriptions), difficulty, job title, questions-per-technology, timer (none/per-tech/global),
  and answer reveal (immediate/end). Submits to `POST /api/sessions`.
- **Generation** (`lib/generator.ts`): uses the **@opencode-ai/sdk** embedded directly in the Next.js app. On first use it spawns a single background `opencode serve` child process and connects an `OpencodeClient` to it (lazily, reused for the whole server process; if the port is already taken it attaches to the running instance). For each quiz it creates a session, sends the session input JSON to the registered `mcq-generator` agent, and reads the generated JSON array back from the assistant's text parts. Progress is tracked by streaming the server's global event stream and writing `status`, `eventCount`, `lastEventAt` into `data/sessions/<id>.json` (state machine `queued → generating → complete | error`), with a silence watchdog that aborts stale runs. The frontend polls `GET /api/sessions/<id>` and shows live progress.
- **Dedupe** (`lib/question-bank.ts`): every question is appended to `data/question-bank.json`
  tagged as `{technology, area, difficulty, jobTitle, sessionId, createdAt, usedCount}`.
  Already-banked questions are sent into the generator prompt as `existingQuestions`
  ("never repeat these"), so consecutive runs produce fresh sets.
- **Quiz** (`app/quiz/[sessionId]/page.tsx`): one question at a time, single-select +
  multi-select, per-tech or global countdown with hard stop, immediate or end reveal.
- **Results** (`app/results/[sessionId]/page.tsx`): score card, per-technology breakdown,
  per-question recap table, explanations.

## The mcq-generator agent
- Registered in `./opencode.json`; prompt at `.opencode/prompts/mcq-generator.txt`.
- Pure text-out agent (all tools denied) — returns strictly a JSON array of questions in
  rapid-grill style. Session input JSON passed as the prompt argument.

## Data files (runtime artifacts, gitignored)
- `data/question-bank.json` — accumulating dedupe store with question metadata
- `data/sessions/<id>.json` — one file per quiz run; source of truth for progress + answers

## Config
- `OPENCODE_BIN` — explicit path to the opencode binary on PATH used to boot the embedded server (default: `opencode` on PATH)
- `OPENCODE_SDK_PORT` — port for the embedded `opencode serve` (default 4097)
- `MCQ_GENERATOR_TIMEOUT_MS` — silence timeout before the watchdog aborts generation (default 360000)

## SDK note
Generation uses the **@opencode-ai/sdk** (`createOpencode`/`createOpencodeClient`), not the `opencode run` CLI subprocess. The SDK version must match the installed `opencode-ai` CLI (the `opencode serve` runtime). Install both:
```sh
npm install @opencode-ai/sdk
npm install -g opencode-ai
```