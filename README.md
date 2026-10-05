# MCQ Interview Drill

Agent-generated technical MCQ practice. Pick your stack, difficulty, job title, question count, timer, and answer-reveal style on the welcome page — a dedicated `mcq-generator` agent (headless opencode) generates a fresh, non-repeating question set, and you answer single/multi-select MCQs one at a time with per-technology scoring. On any individual question you can open an inline chat and ask the `mcq-clarify` agent a follow-up (e.g. "why is each option wrong?"), with the conversation persisted per question. The results page reports how long you took, walks every option with its verdict, and exports the whole session as JSON.

## Quick start

```bash
npm install
npm install -g opencode-ai   # embedded question-generator runtime (opencode serve)
npm run dev                  # http://localhost:3000
```

Question generation uses the [@opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk) embedded in the app. It spawns a background `opencode serve` and drives the `mcq-generator` agent (in `opencode.json`) to produce each question set, reading the JSON array back from the assistant response. The same server powers per-question clarifications via the `mcq-clarify` agent.

## Environment variables

Copy `.env.example` to `.env.local` and adjust as needed. Next.js loads `.env.local` automatically.

### Generation mode

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_EMBEDDED_OPENCODE` | `true` | **`true`** — spawns a local `opencode serve` process and drives the `mcq-generator` agent via the SDK. Requires `opencode-ai` installed globally and authenticated (`opencode auth login`). **`false`** — bypasses the embedded server entirely; questions are generated via direct HTTP calls to Zen and/or OpenRouter APIs. Required for Vercel / serverless deployments. |
| `OPENROUTER_ONLY` | `false` | When `USE_EMBEDDED_OPENCODE=false`, set to `true` to route **all** technologies through OpenRouter (skips Zen). Useful when Zen rate-limits you. When `false`, technologies are split 50/50 between Zen and OpenRouter. |

### Direct API keys (used when `USE_EMBEDDED_OPENCODE=false`)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCODE_ZEN_API_KEY` | Only if `OPENROUTER_ONLY=false` | API key for OpenCode Zen (`big-pickle` model, free tier). Get yours at https://opencode.ai/auth |
| `OPENROUTER_API_KEY` | Yes | API key for OpenRouter. Get yours at https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | No | Override the OpenRouter model. Default: `openrouter/free` (routes to whatever free model is available — small models may not follow complex prompts reliably). Recommended: set to a specific model like `meta-llama/llama-3.1-8b-instruct:free` for consistent results. |

### Embedded server settings (used when `USE_EMBEDDED_OPENCODE=true`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_SDK_PORT` | `4097` | Port for the embedded `opencode serve` process. |
| `MCQ_GENERATOR_TIMEOUT_MS` | `360000` (6 min) | Silence timeout — if the agent produces no events for this long, the run is aborted. |

### Upstash Redis question queue (optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | No | Enables Redis-first question serving **and** durable session storage. Accepts any Redis-compatible URL: `rediss://default:TOKEN@xxx.upstash.io:6379` (Upstash over TLS) or `redis://localhost:6379` (local Redis). Toggle providers by changing this single value. Each queue key is `technology:difficulty:jobTitle`, a sorted set scored by epoch timestamp; questions are served oldest-first via `ZPOPMIN`. When the queue has enough questions no model is called. On shortage or an unreachable database, the shortfall is generated through the configured mode above. Redis-sourced questions that are abandoned (the quiz page is unloaded before the assessment is finished) are returned to their keys via `ZADD` and the session is deleted. Quiz sessions are mirrored to `session:<id>` with a fixed TTL from creation (`SESSION_TTL_SECONDS`, default 86400 = 1 day) and hydrate back into memory on read, surviving restarts. |

### Example configurations

**Local development with embedded opencode (default):**
```env
USE_EMBEDDED_OPENCODE=true
OPENCODE_ZEN_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-v1-...
```

**Direct API — split between Zen and OpenRouter:**
```env
USE_EMBEDDED_OPENCODE=false
OPENROUTER_ONLY=false
OPENCODE_ZEN_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free
```

**Direct API — OpenRouter only (bypass Zen rate limits):**
```env
USE_EMBEDDED_OPENCODE=false
OPENROUTER_ONLY=true
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free
```

## Flow

1. **Welcome** — select technologies (areas expandable), difficulty, job title, questions-per-technology, timer, reveal mode.
2. **Serve / Generate** — when `UPSTASH_REDIS_REST_URL` is set, questions are first popped from the per-technology Redis queue (`ZPOPMIN`, oldest first); only the shortfall is generated by the agent in the background (`POST /api/sessions`), with progress (status + event count) polled live. Abandoned Redis-sourced quizzes have their questions returned to the queue.
3. **Quiz** — one question at a time with immediate or end-of-quiz answer reveal, optional per-tech/global countdown. Under each question, an "Ask a question about this question" panel starts a persisted chat with the `mcq-clarify` agent (`POST /api/sessions/[id>/ask`) for concept clarification and per-option explanations. Each answer carries the time spent on that question, which the results page reports.
4. **Results** — score card with total time taken, a time-taken breakdown, per-technology scores, the full recap table (your answer, correct answer, per-question time, verdict), and expandable explanations that list **all** options A–D with markers, the correct answer(s), and the explanation. Wrong answers sort first; "Expand all / Collapse all" are provided. **Download session (JSON)** exports the full record — selections, timestamps, score, timing, every question with options/correct indexes/your pick/duration, and the chat transcripts.

### Time taken

- `quizStartedAt` is stamped once, on first entry to the question stage, and is not rewound by a mid-quiz refresh (so total time spans the resume). "Retry same set" clears it along with the answers.
- "Retry same set" re-runs the same questions: it clears the previous attempt on the server (answers, start stamp, completion flag) and bumps an `attempt` counter, so the retake lands straight on question 1 instead of the intro. The results page shows `attempt N` from N = 2, exports it, and sends you back into the quiz if you open it with zero answers. The per-question chat threads survive the reset — the questions are identical.
- `durationMs` per question is measured **in the browser** and latched the moment the answer is committed. In immediate-reveal mode the explanation is read *after* that commit, so reading time is not billed to the question.
- Both are optional and best-effort. A refresh mid-question loses that one in-flight duration; the results page shows `—` for unmeasured questions and omits the timing section when nothing was measured. The headline "time taken" prefers the start stamp and falls back to the sum of the measured per-question times, labelled `sum of N/M measured`, so it never blanks out when no stamp survived.
- **Allotted** depends on the timer you picked: `none` shows "no limit", `global` shows the single allowance for the whole set, and `per-tech` shows the total with the technology × time breakdown underneath (one allowance per contiguous run of same-technology questions, which is exactly where the quiz page restarts the countdown). The same breakdown is exported as `timing.allottedByTechnology`.

### Styling

Interaction states are centralised as Tailwind v4 `@utility` rules in `app/globals.css` rather than inline class strings: `btn` (+ `btn-md/sm/xs/lg`, `btn-primary/secondary/ghost`) for buttons, used on the welcome and results pages, and `chip` for the welcome-page selectors. `option-card` is defined for quiz options but the quiz page still uses its original inline classes, so nothing references it yet. `btn` owns the focus-visible ring, the `active:scale` press, and the disabled contract; the variants own only colour, read from `--btn-*` / `--surface-*` / `--border-strong` custom properties that flip in one `prefers-color-scheme` block. Compose them as `btn btn-md btn-primary`. Each of the three utilities sets `appearance: none`, because Tailwind's preflight otherwise leaves `<button>` at `appearance: button`, and WebKit/Safari then paints its native widget background over the transparent one — white-on-white in dark mode.

Generated questions accumulate in a dedupe bank tagged with technology/area/difficulty/job-title metadata; already-banked questions are excluded from future sets. The bank lives at `/tmp/data/question-bank.json` (`lib/question-bank.ts`), so it is cleared when `/tmp` is.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) — learn about Next.js features and API.
- [opencode](https://opencode.ai) — the CLI + agent runtime used for generation.