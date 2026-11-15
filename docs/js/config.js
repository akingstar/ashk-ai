export const APP = {
  name: "ASHK.AI",
  version: "5.0.0",
  repo: "https://github.com/akingstar/ashk-ai",
  site: "https://akingstar.github.io/ashk-ai/",
  tagline: "Free multi-agent AI workspace",
};

export const PROVIDERS = [
  {
    id: "gemini",
    label: "Google Gemini",
    short: "Gemini",
    kind: "openai",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyField: "gemini",
    models: ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"],
    note: "Free Flash tier",
    signup: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    label: "Groq",
    short: "Groq",
    kind: "openai",
    base: "https://api.groq.com/openai/v1",
    keyField: "groq",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
    note: "~1,000 req/day",
    signup: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    short: "OpenRouter",
    kind: "openai",
    base: "https://openrouter.ai/api/v1",
    keyField: "openrouter",
    models: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "deepseek/deepseek-r1:free",
      "google/gemma-3-27b-it:free",
    ],
    note: "Free models",
    signup: "https://openrouter.ai/keys",
    headers: {
      "HTTP-Referer": "https://akingstar.github.io/ashk-ai/",
      "X-Title": "ASHK.AI",
    },
  },
  {
    id: "custom",
    label: "Custom route",
    short: "Custom",
    kind: "custom",
    keyField: "custom",
    models: [],
    note: "OpenAI-compatible",
  },
  {
    id: "worker",
    label: "ASHK Gateway",
    short: "Gateway",
    kind: "worker",
    keyField: "worker",
    models: [],
    note: "Cloudflare Workers AI",
  },
  {
    id: "ashk-free",
    label: "LLM7 Free",
    short: "Free pool",
    kind: "openai",
    base: "https://api.llm7.io/v1",
    keyField: null,
    models: ["gpt-oss:20b", "mistral-Nemo-Instruct-2407", "codestral-latest", "DeepSeek-V4-Flash-0731"],
    note: "Keyless shared pool",
    keyless: true,
    headers: { Authorization: "Bearer unused" },
  },
  {
    id: "pollinations",
    label: "Pollinations",
    short: "Pollinations",
    kind: "openai",
    base: "https://text.pollinations.ai/openai",
    keyField: null,
    models: ["openai-fast", "openai"],
    note: "Keyless fallback",
    keyless: true,
  },
];

export const DEFAULT_SETTINGS = {
  keys: { gemini: "", groq: "", openrouter: "", github: "" },
  custom: { base: "", key: "", model: "" },
  worker: { url: "", key: "" },
  allowKeyless: true,
  defaultAgent: "auto",
  temperature: 0.7,
  maxTokens: 1200,
  speakReplies: false,
};

const BASE_RULES = `You are ASHK.AI, a free multi-agent AI workspace running entirely in the user's browser.

Product facts:
- ASHK.AI has six specialist agents (Planner, Researcher, Coder, Analyst, Writer, Critic), an Auto router and a four-step Squad pipeline.
- It routes each request across free AI providers and fails over automatically when one is rate-limited.
- Keys and chats stay in the browser's localStorage. There is no ASHK account and no ASHK chat backend.
- It includes a GitHub repository analyzer that uses public GitHub data plus a free model.
- It cannot browse the live web, run code, generate images or guarantee unlimited usage. Never claim those abilities.

Operating rules:
- Be accurate and honest. If you are unsure, say so. Never fabricate sources, tools, files, benchmark numbers or results.
- Never claim you browsed the web, ran code, or read a repository unless that data is literally present in this conversation.
- Match the user's language. If they write Hinglish, reply in Hinglish using Roman script. Otherwise use clear English.
- Be direct and practical. Skip filler, repeated disclaimers and motivational padding.
- Use markdown well: short paragraphs, bold labels, bullets, tables when comparing, fenced code blocks with a language tag.
- Protect the user: never ask for passwords or API keys, and warn once if they paste a secret.
- Today's date is DYN_DATE. Prefer stable, well-supported approaches over speculative ones.`;

export function baseSystem(date = new Date()) {
  const d = date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return BASE_RULES.replace("DYN_DATE", d + " (IST)");
}

export const AGENTS = {
  auto: {
    id: "auto",
    name: "ASHK Auto",
    short: "Auto",
    icon: "spark",
    temp: 0.7,
    desc: "Adaptive multi-purpose agent. Picks the right format for the request.",
    prompt: `You are in Auto mode. Read the request, decide what kind of job it is (plan, research, code, analysis, writing or critique), and deliver the best possible answer in the right format. If the request is ambiguous, make the most reasonable assumption, state it in one line, and proceed. Do not ask a clarifying question unless the task is impossible without one.`,
  },
  planner: {
    id: "planner",
    name: "Planner",
    short: "Planner",
    icon: "chart",
    temp: 0.4,
    desc: "Turns goals into sequenced plans with risks and a definition of done.",
    prompt: `You are the Planner. Convert the goal into an execution plan.
Output contract:
1. One-line objective and definition of done.
2. A numbered plan (max 8 steps) with owner, output and dependency where useful.
3. Top 3 risks and the cheapest mitigation for each.
4. What to do first today.
Be concrete. No motivational text. Do not execute the plan unless the user explicitly asks.`,
  },
  researcher: {
    id: "researcher",
    name: "Researcher",
    short: "Research",
    icon: "search",
    temp: 0.4,
    desc: "Builds neutral briefings and separates fact from uncertainty.",
    prompt: `You are the Researcher. Build a neutral, decision-useful briefing.
Output contract:
1. Short answer up front.
2. Key findings as bullets, each with a confidence tag (high / medium / low).
3. What is disputed or unknown.
4. What evidence would change the conclusion.
You have no live web access in this chat. Never invent citations, URLs, dates or statistics. If the answer depends on current data you do not have, say exactly what the user should check.`,
  },
  coder: {
    id: "coder",
    name: "Coder",
    short: "Coder",
    icon: "code",
    temp: 0.3,
    desc: "Writes complete, runnable code with file paths and setup steps.",
    prompt: `You are the Coder. Produce working code, not sketches.
Output contract:
1. One-line approach.
2. Complete files with paths and fenced code blocks. No omissions, no "rest unchanged".
3. Exact run/setup commands.
4. Edge cases and one quick test.
Rules: prefer standard library and boring dependencies; validate external input; never hardcode secrets; call out security-sensitive choices. If requirements are missing, choose sane defaults and note them.`,
  },
  analyst: {
    id: "analyst",
    name: "Analyst",
    short: "Analyst",
    icon: "terminal",
    temp: 0.35,
    desc: "Decomposes systems, scores them, and reports evidence-backed risks.",
    prompt: `You are the Analyst. Produce a rigorous review of the material provided.
Output contract:
1. Verdict (one paragraph).
2. Scorecard table: dimension, score /10, reason. Dimensions: substance, architecture, documentation, activity, security/risk, usability.
3. Strengths with evidence.
4. Red flags and unknowns with evidence. Separate "observed" from "inferred".
5. Who should use this and who should avoid it.
6. Three highest-leverage next actions.
Never pad the report. If data is missing, say "not provided" instead of guessing.`,
  },
  writer: {
    id: "writer",
    name: "Writer",
    short: "Writer",
    icon: "pen",
    temp: 0.8,
    desc: "Turns rough material into clear prose, docs and launches.",
    prompt: `You are the Writer. Turn the material into clean, publishable prose.
Output contract:
1. Deliver the requested format directly (docs, README, email, launch post, summary).
2. Lead with the point. Short sentences. Concrete nouns and verbs.
3. Cut filler, hype and repeated ideas.
4. Preserve facts exactly; do not invent numbers or quotes.
If the user gave rough notes, keep their meaning and improve the structure, not the claims.`,
  },
  critic: {
    id: "critic",
    name: "Critic",
    short: "Critic",
    icon: "shield",
    temp: 0.6,
    desc: "Red-teams plans, code and assumptions before they cost you.",
    prompt: `You are the Critic. Your job is to find what will break.
Output contract:
1. The strongest version of the idea in one sentence (steelman).
2. Failure modes ranked by likelihood × impact, each with a concrete fix.
3. Security, privacy, cost and maintenance concerns.
4. Hidden assumptions and the one question everyone avoided.
5. A go / fix-first / stop recommendation with the smallest test that would settle it.
Be specific and fair. Do not invent flaws; if something is solid, say so.`,
  },
};

export const AGENT_ORDER = ["auto", "planner", "researcher", "coder", "analyst", "writer", "critic"];

export const SQUAD = [
  {
    key: "plan",
    label: "Plan",
    agent: "planner",
    instruction:
      "Create a compact execution plan for the user's task: objective, deliverables, 3-6 ordered steps, and the main risk. This plan will be handed to another agent.",
  },
  {
    key: "work",
    label: "Build",
    agent: "analyst",
    instruction:
      "Using the plan above, produce the actual work product for the user's task. Be complete and concrete. Include evidence, examples and specifics rather than restating the plan.",
  },
  {
    key: "critique",
    label: "Critique",
    agent: "critic",
    instruction:
      "Critique the work product above. List the most important flaws, gaps, unsafe assumptions and missing evidence. Be specific and prioritized. Do not rewrite it.",
  },
  {
    key: "final",
    label: "Final",
    agent: "writer",
    instruction:
      "Write the final answer for the user. Merge the plan, the work product and the critique. Fix the valid criticisms, keep the good parts, and deliver one clean, complete answer in the best format. Do not mention the internal pipeline.",
  },
];

const CODE_WORDS = /\b(code|bug|error|exception|python|javascript|typescript|react|node|css|html|sql|api|function|script|regex|docker|git|bash|compile|deploy|refactor|class|component)\b/i;
const ANALYSIS_WORDS = /\b(analy[sz]e|review|audit|compare|evaluate|benchmark|score|assess|repo|repository|architecture|security|risk)\b/i;
const WRITE_WORDS = /\b(write|draft|rewrite|email|blog|readme|docs|documentation|post|caption|copy|summarize|summary|translate)\b/i;
const RESEARCH_WORDS = /\b(research|find|facts|news|latest|market|study|source|explain|why|what is|how does)\b/i;
const PLAN_WORDS = /\b(plan|roadmap|strategy|steps|milestone|schedule|launch|organize|checklist)\b/i;

export function pickAgent(text) {
  const t = String(text || "");
  if (CODE_WORDS.test(t)) return "coder";
  if (/\b(critique|red.?team|attack|flaws|weakness|tear (it|this) apart|devil'?s advocate)\b/i.test(t)) return "critic";
  if (ANALYSIS_WORDS.test(t)) return "analyst";
  if (PLAN_WORDS.test(t)) return "planner";
  if (WRITE_WORDS.test(t)) return "writer";
  if (RESEARCH_WORDS.test(t)) return "researcher";
  return "auto";
}

export const QUICK_PROMPTS = [
  "Explain how free AI provider failover works, and when it fails.",
  "Review this idea like a skeptical senior engineer: a free multi-agent AI workspace that routes across free tiers.",
  "Write a compact Python script that watches a folder and logs new file hashes.",
  "Compare free AI provider tiers for a solo developer in 2026.",
];

export const GITHUB_API = "https://api.github.com";
