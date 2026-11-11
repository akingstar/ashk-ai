const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Key",
};
const j = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM = () =>
  `You are Ashk AI, a smart, fast personal voice assistant. Today is ${new Date().toDateString()}. ` +
  `Reply in the user's language (Hinglish in Roman script if they use Hinglish). ` +
  `Keep replies short and natural since they are spoken aloud. No markdown, no emojis.`;

const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"];

async function llm(env, messages) {
  for (const m of MODELS) {
    try {
      const r = await env.AI.run(m, { messages, max_tokens: 400 });
      if (r.response) return r.response;
    } catch (e) {}
  }
  throw new Error("saare models fail hue (free limit ho sakti hai)");
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
    if (pathname === "/") return j({ status: "Ashk AI online" });
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
        const { messages } = await req.json();
        const reply = await llm(env, [{ role: "system", content: SYSTEM() }, ...messages.slice(-20)]);
        return j({ reply });
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
