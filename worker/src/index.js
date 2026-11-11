const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Key",
};
const j = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL_OK = new Set(["@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"]);
const SYSTEM = (mem, mode) =>
  `You are Ashk AI, a smart, fast personal voice assistant. Now: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. ` +
  `Reply in the user's language (Hinglish in Roman script if they use Hinglish). ${mode === "chat" ? "Give complete, detailed, well-structured answers in markdown (use code blocks for code). Be direct, practical and honest; skip needless disclaimers and lectures. Think step by step on hard problems. " : "Keep replies short and natural since they are spoken aloud. No markdown, no emojis. "}` +
  `Use tools when helpful: web_search for current facts or news, remember when the user asks you to remember something, phone tools to control the user's phone. Never invent tool results.` +
  (mem && mem.length ? ` Known about the user: ${mem.join("; ")}.` : "");

const S = { type: "string" };
const P = (properties, required = []) => ({ type: "object", properties, required });
const TOOLS = [
  { name: "web_search", description: "Search the web for current information", parameters: P({ query: S }, ["query"]) },
  { name: "get_time", description: "Current date and time in India", parameters: P({}) },
  { name: "remember", description: "Save a fact about the user for future chats", parameters: P({ fact: S }, ["fact"]) },
  { name: "battery", description: "Get phone battery level", parameters: P({}) },
  { name: "torch", description: "Turn the phone flashlight on or off", parameters: P({ state: { type: "string", enum: ["on", "off"] } }, ["state"]) },
  { name: "vibrate", description: "Vibrate the phone", parameters: P({}) },
  { name: "notify", description: "Show a notification on the phone", parameters: P({ title: S, text: S }, ["text"]) },
  { name: "open_url", description: "Open a URL on the phone", parameters: P({ url: S }, ["url"]) },
  { name: "location", description: "Get the phone's current GPS location", parameters: P({}) },
];

const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"];

async function llm(env, body, pref) {
  for (const m of pref ? [pref, ...MODELS] : MODELS) {
    try {
      const r = await env.AI.run(m, body);
      if (r.response || r.choices?.[0]?.message?.content || (r.tool_calls && r.tool_calls.length)) return r;
    } catch (e) {}
  }
  throw new Error("saare models fail hue (free limit ho sakti hai)");
}

async function search(env, q) {
  if (env.TAVILY_KEY) {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.TAVILY_KEY, query: q, max_results: 4, include_answer: true }),
    });
    const d = await r.json();
    return (d.answer ? d.answer + " | " : "") + (d.results || []).map((x) => x.title + ": " + x.content.slice(0, 200)).join(" | ");
  }
  const lang = /[\u0900-\u097F]/.test(q) ? "hi" : "en";
  const r = await fetch(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=4`,
    { headers: { "User-Agent": "AshkAI/1.0" } }
  );
  const d = await r.json();
  return (d.query?.search || []).map((x) => x.title + ": " + x.snippet.replace(/<[^>]+>/g, "")).join(" | ") || "koi result nahi mila";
}

const b64 = (buf) => {
  let s = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
  return btoa(s);
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(req.url);
    if (pathname === "/") return j({ status: "Ashk AI online", v: 3 });
    if (env.APP_KEY && req.headers.get("X-Key") !== env.APP_KEY) return j({ error: "galat key" }, 401);
    try {
      if (pathname === "/stt" && req.method === "POST") {
        const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
          audio: b64(await req.arrayBuffer()),
          task: "transcribe",
          vad_filter: true,
          initial_prompt: "Hinglish: Hindi aur English mix, Roman script mein.",
        });
        return j({ text: r.text || "" });
      }
      if (pathname === "/chat" && req.method === "POST") {
        const { messages, memory, tools, mode, model } = await req.json();
        const r = await llm(env, {
          messages: [{ role: "system", content: SYSTEM(memory, mode) }, ...messages.slice(-24)],
          max_tokens: mode === "chat" ? 2048 : 400,
          ...(tools ? { tools: TOOLS } : {}),
        }, MODEL_OK.has(model) ? model : null);
        const tool_calls = (r.tool_calls || []).map((t) => {
          let a = t.arguments ?? t.function?.arguments ?? {};
          if (typeof a === "string") { try { a = JSON.parse(a); } catch { a = {}; } }
          return { name: t.name || t.function?.name, args: a };
        });
        const text = r.response ?? r.choices?.[0]?.message?.content ?? "";
        return j({ reply: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), tool_calls });
      }
      if (pathname === "/tool" && req.method === "POST") {
        const { name, args = {} } = await req.json();
        if (name === "get_time")
          return j({ time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" }) });
        if (name === "web_search") return j({ results: await search(env, String(args.query || "")) });
        return j({ error: "unknown tool" }, 400);
      }
      if (pathname === "/tts" && req.method === "POST") {
        const { text } = await req.json();
        const r = await env.AI.run("@cf/myshell-ai/melotts", { prompt: text, lang: "en" });
        return j({ audio: r.audio });
      }
    } catch (e) {
      return j({ error: String(e.message || e) }, 500);
    }
    return j({ error: "not found" }, 404);
  },
};
