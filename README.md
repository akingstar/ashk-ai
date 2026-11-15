# ASHK.AI

**Free multi-agent AI workspace that runs in your browser.**

Live site: **https://akingstar.github.io/ashk-ai/**
Docs: [akingstar.github.io/ashk-ai/#/docs](https://akingstar.github.io/ashk-ai/#/docs)

ASHK.AI is an open-source, client-side AI console. It routes your prompt across several free AI
providers, fails over automatically when one is rate-limited, and gives you seven specialist agents,
a multi-agent Squad pipeline and a GitHub repository analyzer. No account, no card, no ASHK backend
for chat. Your keys never leave `localStorage`.

> **Honest by design:** no hosted AI is truly unlimited. ASHK.AI is free because it does not own a
> model — it composes provider free tiers behind one interface. Real limits are documented below.

---

## Features

- **Automatic free-route failover** — BYOK providers first, then an optional self-hosted gateway,
  then keyless pools. Streaming SSE, 75-second timeout, provider skipping on auth errors and model
  fallback on rate limits.
- **Seven specialist agents + Auto** — Start (Claude Code-style coding agent), Planner, Researcher, Coder, Analyst, Writer and Critic, each
  with its own temperature and output contract. Auto picks the best fit locally, with no extra call.
- **Squad mode** — Plan → Build → Critique → Final. Four model calls for work where quality matters
  more than quota.
- **GitHub repository analyzer** — public GitHub API data (metadata, languages, README, structure,
  releases, contributors) plus a deterministic 0–100 scorecard and a structured AI review.
- **Professional console** — streaming markdown, syntax-tagged code blocks, tables, chat history,
  dictation, optional read-aloud, route diagnostics and token estimates.
- **Private by default** — keys and chats stay in your browser. One click clears all local data.
- **Installable PWA** — offline shell via service worker; plain HTML/CSS/ES modules, no build step.
- **Optional voice and VICIdial stack** — the original voice console, Cloudflare Worker (chat, STT,
  TTS, tools) and Termux phone/VICIdial bridge are preserved in [`docs/legacy.html`](docs/legacy.html)
  and [`worker/`](worker/).

## Quickstart

1. Open the **live site** or run it locally (below).
2. Type a prompt. The keyless route is ready immediately — no setup.
3. For more headroom, open **Keys & settings** and paste a free Gemini, Groq or OpenRouter key.
   Keys are used before the shared keyless pool and stored only in this browser.
4. Pick an agent, or enable **Squad** for architecture reviews and high-stakes answers.
5. Paste `owner/repo` in the **Analyzer** to review any public GitHub project.

### Run locally

```bash
git clone https://github.com/akingstar/ashk-ai.git
cd ashk-ai
python -m http.server 8080 --directory docs
# open http://localhost:8080
```

No dependencies, no build step. Any static server works.

## Free routes

| Route | Free allowance | You need | Best for |
| --- | --- | --- | --- |
| **LLM7 Free** (keyless) | 10 requests/min anonymous; daily token cap per IP | Nothing | Instant chat, demos, repo reviews |
| **Pollinations** (keyless fallback) | Best effort; browser requests may hit Turnstile | Nothing | Backup keyless route |
| **Google Gemini** | Free Flash tiers | Free AI Studio key | Long context, general work |
| **Groq** | ~30 RPM, ~1,000 requests/day | Free key | Very fast short prompts |
| **OpenRouter** | ~20 RPM, ~50 requests/day on `:free` | Free key | Model variety |
| **Cloudflare Workers AI** | 10,000 neurons/day | Workers free tier + optional gateway | Private gateway, voice |
| **Custom / Ollama** | Your hardware | OpenAI-compatible URL | Genuinely no provider caps |

Limits reflect provider documentation checked in October–November 2026. Free tiers change without
notice — that is exactly why ASHK routes across several. The keyless pool is shared per IP, so heavy
use can return HTTP 429; adding a free key or running Ollama removes that ceiling.

**What "unlimited" means here:** no paywall, no subscription and no card on this project's side.
You get as much usage as the upstream free tiers allow, automatically spread across providers.
For genuinely no caps, run Ollama locally and add it as a custom route.

### Unlimited local route with Ollama

```bash
ollama pull qwen2.5:0.5b
setx OLLAMA_ORIGINS "https://akingstar.github.io"   # Windows; restart Ollama after
```

Then open **Keys & settings → Custom route** and set:

| Field | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:11434/v1` |
| Model | `qwen2.5:0.5b` |
| Key | empty |

ASHK puts the custom route first, so requests never leave your machine. Local models have no
rate limit, but they are slower and weaker than hosted models: `qwen2.5:0.5b` needs about 0.5 GB
of free RAM, and a 7B model needs roughly 8 GB. Local requests get a 10-minute timeout instead of 75s.


## Agents and Squad

Agents are system prompts with different temperatures and output contracts:

| Agent | Focus |
| --- | --- |
| **ASHK Auto** | Routes by keyword and intent, then answers directly |
| **Planner** | Scope, deliverables, sequence, risks |
| **Researcher** | Evidence-led synthesis, explicit uncertainty |
| **Coder** | Runnable code, edge cases, no invented APIs |
| **Analyst** | Trade-offs, comparison tables, scoring |
| **Writer** | Polished long-form prose and editing |
| **Critic** | Flaws, gaps, assumptions, missing tests |

**Squad** runs four calls:

```text
plan     → Planner   deliverables, order, risks
work     → Analyst   evidence-led first draft
critique → Critic    flaws, gaps, assumptions
final    → Writer    merged, polished answer
```

Squad consumes roughly four times the tokens of a single message. Use it selectively.

## GitHub Analyzer

The analyzer uses the public GitHub API for repository metadata, languages, README, top-level
structure, latest release, contributors and rate-limit headers. It computes a local scorecard across
eight dimensions, then asks the free model for a structured report covering strengths, risks, code
quality signals and concrete next steps.

- No GitHub login required for public repositories.
- Default API limit is 60 requests/hour per IP.
- Add a fine-grained, read-only GitHub token in settings to raise it to 5,000/hour.
- Tokens and chat data stay in `localStorage`; never commit them.

## Privacy and security

- No ASHK account and no ASHK-owned chat backend.
- Provider keys are stored only in this browser's `localStorage`.
- Prompts travel directly from your browser to the provider you configured.
- The optional Cloudflare gateway is self-hosted by you; its key also stays local.
- **Clear all local data** in settings removes keys, chats and history.

A static site cannot hide a shared secret. Never commit provider keys or paste customer data,
passwords or private code into a free provider. Free tiers often train on submitted data.

## Architecture

```text
docs/                 static frontend (GitHub Pages, no build)
  index.html          app shell, all views, docs, settings dialog
  css/app.css         design system and responsive layout
  js/config.js        providers, agents, squad, defaults, system rules
  js/ai.js            failover router, SSE streaming, diagnostics
  js/github.js        GitHub API bundle, scorecard, analysis prompt
  js/markdown.js      safe escape-first markdown renderer
  js/store.js         localStorage settings and chat history
  js/app.js           controller: views, chat, agents, squad, analyzer
  legacy.html         preserved voice console (worker + phone tools)
  sw.js               offline shell, network-first navigation
worker/               optional Cloudflare Worker (chat, STT, TTS, tools)
termux/               optional phone and VICIdial bridge
deploy.sh             Worker deployment helper
```

Routing precedence: configured BYOK keys → custom OpenAI-compatible route → ASHK Worker gateway →
keyless LLM7 pool → Pollinations fallback. Auth failures skip a provider; rate limits and timeouts
move to the next model; every failure is aggregated into one clear error.

## Deploy your own

### Frontend (GitHub Pages)

1. Fork or clone the repository.
2. Settings → Pages → **Deploy from a branch** → `main` → `/docs`.
3. Open `https://<user>.github.io/<repo>/`.
4. Optional: add provider keys in the site settings. Do not put keys in source files.

### Optional Worker gateway

The Worker adds Workers AI chat, Whisper STT, MeloTTS and tools (web search, time, VICIdial).

```bash
export CF_API_TOKEN=...        # Cloudflare API token with Workers edit
export CF_ACCOUNT_ID=...
export ASHK_KEY=...            # optional shared key checked by the Worker
export TAVILY_KEY=...          # optional, better web search
./deploy.sh
```

Then paste the Worker URL and key into site settings. `worker/wrangler.toml` is included for
Wrangler-based deploys.

## Voice console, phone tools and VICIdial (legacy)

The original voice-first console is preserved at [`docs/legacy.html`](docs/legacy.html) and still
uses the Worker and the Termux bridge.

- **Phone tools** (torch, battery, vibrate, notify, location, open URL): install Termux and the
  Termux:API app, then `pkg install python termux-api`, and run
  `ASHK_KEY=<same key> python termux/server.py`.
- **VICIdial read tools** run freely: health, campaign status, DNC list, server checks.
- **Write actions** — campaign on/off, DNC add and arbitrary `vps_cmd` — require explicit approval
  in the browser and a server-side confirmation flag.
- **SSH** uses `~/.ssh/ashk_vps` by default. Set `VPS_HOST`, `VPS_USER` and `VPS_PORT` in the
  Termux environment. Start everything with `bash termux/start.sh`.

Treat the bridge as production infrastructure: restrict it to trusted networks, keep `ASHK_KEY`
secret, and test changes outside dialing hours.

## Status and limits

- The keyless LLM7 pool was verified end-to-end in November 2026. It enforces per-minute and daily
  token limits on shared IPs; observed 429 cooldowns ranged from seconds to about an hour.
  Pollinations may reject browser requests with `403 Missing Turnstile token`. Add a free key for
  reliable daily use.
- Free providers can change endpoints, models or quotas without notice. The router handles failures,
  but a dead provider means fewer routes until its configuration is updated.
- The analyzer reads only public GitHub data and does not execute repository code.
- Browser speech features depend on `webkitSpeechRecognition` / `SpeechSynthesis` support.

## Contributing

Issues and pull requests are welcome. Keep the frontend dependency-free, test changes against a
local static server, and never commit secrets. For provider changes, update both the route config
and the docs table so the limits stay honest.

## License

[MIT](LICENSE) © 2026 akingstar · ASHK.AI

## Credits

Built by [akingstar](https://github.com/akingstar). Free-route research was informed by the
open-source community, including [zebbern/no-cost-ai](https://github.com/zebbern/no-cost-ai) and
[mnfst/awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis). Provider names and
limits belong to their owners; ASHK.AI is not affiliated with them.
