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
- **Generation** (`lib/generator.ts`): uses the **@opencode-ai/sdk** embedded directly in the Next.js app. On first use it spawns a single background `opencode serve` child process and connects an `OpencodeClient` to it (lazily, reused for the whole server process; if the port is already taken it attaches to the running instance). For each quiz it creates a session, sends the session input JSON to the registered `mcq-generator` agent, and reads the generated JSON array back from the assistant's text parts. Progress is tracked by streaming the server's global event stream and writing `status`, `eventCount`, `lastEventAt` into the session store (state machine `queued → generating → complete | error`), with a silence watchdog that aborts stale runs. The frontend polls `GET /api/sessions/<id>` and shows live progress.
- **Sessions** (`lib/session-store.ts` + `lib/redis-client.ts`): sessions are **memory-primary** (a `globalThis` Map) with a **best-effort Redis mirror** as durable backup under key `session:<id>` (JSON), TTL fixed at creation (`SESSION_TTL_SECONDS`, default 86400 = 1 day) and never refreshed. Reads hit memory first, fall back to Redis (hydrating back into memory), and surface "session not found" when the id is in neither — this survives server restarts and serverless cold starts.
- **Redis queue first** (`lib/redis-question-queue.ts`): when `REDIS_URL` is set, `runGeneration` first pops up to `questionsPerTech` from each per-tech sorted-set key `technology:difficulty:jobTitle` via `ZPOPMIN` (score = epoch timestamp → oldest first). Fully served via queue → session completes with no model call; partial → only the shortfall technologies are generated; unreachable/empty → unchanged full generation. Popped questions carry `redisClaims` so an **explicitly abandoned** assessment (the "← New set"/"← Back to welcome" buttons or any SPA navigation away from the quiz page) can `ZADD` them back and delete the session via `POST /api/sessions/<id>/restore`. Refreshes and tab unloads intentionally do **not** restore — the session (with its `answers`) survives so the quiz page resumes an in-progress session straight at the first unanswered question (skipping the intro, timer restarted, answers preserved); a fully-answered session redirects to results. `hasRedisSourced` is exposed to the client; `redisClaims` never is.
- **Dedupe** (`lib/question-bank.ts`): every question is appended to `/tmp/data/question-bank.json`
  tagged as `{technology, area, difficulty, jobTitle, sessionId, createdAt, usedCount}`.
  Already-banked questions are sent into the generator prompt as `existingQuestions`
  ("never repeat these"), so consecutive runs produce fresh sets.
- **Quiz** (`app/quiz/[sessionId]/page.tsx`): one question at a time, single-select +
  multi-select, per-tech or global countdown with hard stop, immediate or end reveal. The
  bottom chat section and the option glyphs (`✓` / `⊘ missed` / `✗`) are **unchanged from the
  original design** — do not restyle this page; the only additions are the timing hooks below.
  Landing rule when a complete session loads (`land()`, once per mount): 0 answers +
  `attempt > 1` → straight into question 1 (a retake), 0 answers + `attempt` 1/absent → intro,
  some answers → first unanswered question, all answered → redirect to results.
- **Retry same set** (results page → `PATCH /api/sessions/<id>` body `{resetAnswers: true}` →
  `router.push(/quiz/<id>)`): the reset **must** land before the navigation, because a
  fully-answered session makes `land()` redirect straight back to results — that ordering was
  what made the old plain link a no-op loop. The reset clears `answers`, `quizStartedAt` and
  `assessmentCompleted` (so an abandoned retake is handled like any unfinished assessment) and
  bumps `attempt`; `chats` and `completedAt` (a *generation* timestamp) are left alone. The
  results page shows `attempt N` when N > 1, exports it, and redirects to the quiz when a
  complete session has zero answers (Back after a retry, or a pasted results URL).
- **Timing** (`app/quiz/[sessionId]/page.tsx` → `app/api/sessions/[id]/route.ts`):
  `quizStartedAt` is stamped once on first entry to the question stage (PATCH body
  `{quizStartedAt}`; the server keeps the first stamp so a resume does not rewind it), and
  each answer carries `durationMs`, latched client-side via `commitDuration()` at answer-commit
  time so immediate-reveal reading time is not billed to the question. `resetAnswers` clears
  both. `assessmentCompleted` is additive — the final answer PATCH sends it alongside the
  answer and the route must not short-circuit before saving it.
- **Results** (`app/results/[sessionId]/page.tsx`): score card (incl. total time taken),
  time-taken breakdown (total / allotted / measured / fastest / slowest; in `per-tech` mode the
  Allotted cell also lists technology × time under the total — the allowance is derived from the
  contiguous question sections, since the quiz page restarts the countdown on every technology
  change, and the JSON export mirrors it as `timing.allottedByTechnology`), per-technology
  breakdown, recap table (option **text** + verdict + per-question time), and expandable
  explanations that list **all** options A–D with markers, the correct answer(s) and the
  explanation, wrong answers first. The score card's "time taken" is the headline figure:
  it prefers `quizStartedAt → completedAt|last answeredAt`, and falls back to the sum of
  measured `durationMs` (labelled "sum of N/M measured") so it never silently blanks out
  when no start stamp survived. **Download session (JSON)** builds the export client-side
  via `lib/download.ts` (session + derived score/timing/questions/chats; `redisClaims` is
  already stripped by the GET route). Formatting lives in `lib/format.ts` (`formatDuration`).
- **Styling** (`app/globals.css`): interaction states are Tailwind v4 `@utility` rules, not
  inline class strings — `btn` (+ `btn-md/sm/xs/lg`, `btn-primary/secondary/ghost`) on the
  welcome/results pages, `chip` on the welcome page. `option-card` is defined for the quiz
  options but nothing references it yet (the quiz page kept its original inline classes). `btn` owns the focus ring, `active:scale` press and disabled
  contract; variants own only colour, read from `--btn-*`/`--surface-*`/`--border-strong`
  custom properties that flip in a single `prefers-color-scheme` block. Reveal-state colours
  (emerald/amber/red) stay inline at the call site because they are dynamic. **`btn`,
  `option-card` and `chip` must each declare `appearance: none`** — v4 preflight sets
  `appearance: button` on `<button>`, and WebKit/Safari then paints the native widget
  background while ignoring `background-color`, which renders a transparent-bg button
  white-on-white in dark mode (worst on the option cards, whose resting bg is transparent).
  Do not add a `background-color` to those utilities to work around it: the utilities and
  the state classes share the utilities layer, so source order would decide the winner and
  the selected/reveal backgrounds could be clobbered.

## The mcq-generator agent
- Registered in `./opencode.json`; prompt at `.opencode/prompts/mcq-generator.txt`.
- Pure text-out agent (all tools denied) — returns strictly a JSON array of questions in
  rapid-grill style. Session input JSON passed as the prompt argument.

## Data files (runtime artifacts, gitignored)
- `/tmp/data/question-bank.json` — accumulating dedupe store with question metadata (lives under
  `/tmp`, so it is lost when `/tmp` is cleared or the container is recycled)

## Config
- `OPENCODE_BIN` — explicit path to the opencode binary on PATH used to boot the embedded server (default: `opencode` on PATH)
- `OPENCODE_SDK_PORT` — port for the embedded `opencode serve` (default 4097)
- `MCQ_GENERATOR_TIMEOUT_MS` — silence timeout before the watchdog aborts generation (default 360000)
- `SESSION_TTL_SECONDS` — fixed Redis mirror TTL for quiz sessions, stamped once at creation (default 86400 = 1 day)

## SDK note
Generation uses the **@opencode-ai/sdk** (`createOpencode`/`createOpencodeClient`), not the `opencode run` CLI subprocess. The SDK version must match the installed `opencode-ai` CLI (the `opencode serve` runtime). Install both:
```sh
npm install @opencode-ai/sdk
npm install -g opencode-ai
```