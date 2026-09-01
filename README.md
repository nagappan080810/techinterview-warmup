# MCQ Interview Drill

Agent-generated technical MCQ practice. Pick your stack, difficulty, job title, question count, timer, and answer-reveal style on the welcome page — a dedicated `mcq-generator` agent (headless opencode) generates a fresh, non-repeating question set, and you answer single/multi-select MCQs one at a time with per-technology scoring. On any individual question you can open an inline chat and ask the `mcq-clarify` agent a follow-up (e.g. "why is each option wrong?"), with the conversation persisted per question.

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
2. **Generate** — `POST /api/sessions` spawns the agent in the background; progress (status + event count) is polled live.
3. **Quiz** — one question at a time with immediate or end-of-quiz answer reveal, optional per-tech/global countdown. Under each question, an "Ask a question about this question" panel starts a persisted chat with the `mcq-clarify` agent (`POST /api/sessions/[id]/ask`) for concept clarification and per-option explanations.
4. **Results** — score card, per-technology breakdown, full recap table and explanations.

Generated questions accumulate in `data/question-bank.json` tagged with technology/area/difficulty/job-title metadata; already-used questions are excluded from future sets.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) — learn about Next.js features and API.
- [opencode](https://opencode.ai) — the CLI + agent runtime used for generation.