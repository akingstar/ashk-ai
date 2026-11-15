import { PROVIDERS } from "./config.js";

const OPENROUTER_MODEL_TTL = 10 * 60 * 1000;
let openRouterCache = { at: 0, model: null };

class HttpError extends Error {
  constructor(status, message, body = "") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

function keyFor(provider, settings) {
  if (provider.id === "custom") return settings.custom.key || "local";
  if (provider.id === "worker") return settings.worker.key || "";
  if (!provider.keyField) return "";
  return (settings.keys || {})[provider.keyField] || "";
}

export function isReady(provider, settings) {
  if (provider.id === "custom") return Boolean(settings.custom.base && settings.custom.model);
  if (provider.id === "worker") return Boolean(settings.worker.url);
  if (provider.keyless) return Boolean(settings.allowKeyless);
  return Boolean(keyFor(provider, settings));
}

export function providerStatus(settings) {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    short: p.short,
    note: p.note,
    keyless: Boolean(p.keyless),
    ready: isReady(p, settings),
    model: p.models[0] || settings.custom.model || "workers-ai",
  }));
}

export function buildChain(settings) {
  return PROVIDERS.filter((p) => isReady(p, settings));
}

function normalizeBase(base) {
  const b = String(base || "").trim().replace(/\/+$/, "");
  if (!b) throw new Error("Custom base URL missing");
  return /\/chat\/completions$/i.test(b) ? b : b + "/chat/completions";
}

async function openRouterFreeModel(key) {
  const now = Date.now();
  if (openRouterCache.model && now - openRouterCache.at < OPENROUTER_MODEL_TTL) {
    return openRouterCache.model;
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    const free = (data.data || [])
      .filter((m) => String(m.id || "").endsWith(":free"))
      .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
    if (!free.length) return null;
    openRouterCache = { at: now, model: free[0].id };
    return free[0].id;
  } catch {
    return null;
  }
}

async function resolveModels(provider, settings) {
  if (provider.id === "custom") return [settings.custom.model].filter(Boolean);
  if (provider.id === "worker") return ["workers-ai"];
  if (provider.id === "openrouter") {
    const discovered = await openRouterFreeModel(keyFor(provider, settings));
    const list = discovered ? [discovered, ...provider.models] : provider.models;
    return [...new Set(list)];
  }
  return provider.models.length ? [provider.models[0], ...provider.models.slice(1)] : [];
}

function timeoutSignal(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort(new DOMException("Provider timeout", "TimeoutError"));
    } catch {
      controller.abort();
    }
  }, ms);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function contentFromMessage(message) {
  if (!message) return "";
  const c = message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

async function callOpenAI(provider, model, opts) {
  const { messages, system, temperature, maxTokens, onToken, signal, stream = true } = opts;
  const key = keyFor(provider, opts.settings);
  const base = provider.id === "custom" ? normalizeBase(opts.settings.custom.base) : provider.base;
  const url = base.replace(/\/+$/, "") + "/chat/completions";

  const body = {
    model,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };

  const headers = { "Content-Type": "application/json", ...(provider.headers || {}) };
  if (key) headers.Authorization = `Bearer ${key}`;

  const t = timeoutSignal(signal, 75000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: t.signal,
    });
  } catch (err) {
    t.clear();
    if (signal?.aborted) throw err;
    throw new Error(
      err?.name === "TimeoutError"
        ? "timeout after 75s"
        : "network or CORS blocked (" + (err?.message || "fetch failed") + ")"
    );
  }

  if (!res.ok) {
    t.clear();
    const data = await readJson(res);
    const detail =
      data?.error?.message || data?.message || data?.raw || data?.error || res.statusText || "request failed";
    throw new HttpError(res.status, String(detail).slice(0, 260), String(detail).slice(0, 600));
  }

  const type = res.headers.get("content-type") || "";
  if (!stream || type.includes("application/json") || !res.body) {
    const data = await readJson(res);
    t.clear();
    if (data?.error) throw new HttpError(502, data.error.message || "provider error");
    const text = contentFromMessage(data?.choices?.[0]?.message) || data?.result?.response || "";
    if (text && onToken) onToken(text, text);
    return { text, raw: data };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let lastPayload = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(":")) continue;
        const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
        if (payload === "[DONE]") {
          t.clear();
          return { text: text || contentFromMessage(lastPayload?.choices?.[0]?.message), raw: lastPayload };
        }
        try {
          const json = JSON.parse(payload);
          lastPayload = json;
          if (json?.error) throw new HttpError(502, json.error.message || "stream error");
          const delta =
            json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? "";
          if (typeof delta === "string" && delta) {
            text += delta;
            onToken?.(delta, text);
          }
        } catch (err) {
          if (err instanceof HttpError) throw err;
        }
      }
    }
  } finally {
    t.clear();
  }

  if (!text) {
    const fallback = contentFromMessage(lastPayload?.choices?.[0]?.message);
    if (fallback) return { text: fallback, raw: lastPayload };
    throw new Error("empty response from provider");
  }
  return { text, raw: lastPayload };
}

async function callWorker(provider, opts) {
  const { messages, system, onToken, signal, settings } = opts;
  const url = String(settings.worker.url || "").replace(/\/+$/, "");
  if (!url) throw new Error("worker URL missing");
  const t = timeoutSignal(signal, 90000);
  try {
    const res = await fetch(url + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Key": settings.worker.key || "" },
      body: JSON.stringify({
        messages: system ? [{ role: "system", content: system }, ...messages] : messages,
        memory: [],
        tools: false,
        mode: "chat",
        model: "",
      }),
      signal: t.signal,
    });
    const data = await readJson(res);
    if (!res.ok) throw new HttpError(res.status, data.error || "gateway error");
    const text = data.reply || "";
    if (!text) throw new Error("empty gateway response");
    onToken?.(text, text);
    return { text, raw: data };
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(err?.name === "TimeoutError" ? "gateway timeout" : err.message || "gateway failed");
  } finally {
    t.clear();
  }
}

async function callProvider(provider, model, opts) {
  if (provider.kind === "worker") return callWorker(provider, opts);
  return callOpenAI(provider, model, { ...opts, stream: opts.stream !== false });
}

function friendly(err) {
  if (err instanceof HttpError) {
    const map = { 401: "invalid or missing key", 403: "blocked by provider", 404: "model not found", 429: "rate limited", 500: "provider error", 502: "bad upstream response", 503: "provider unavailable" };
    return `${err.status} ${map[err.status] || "error"}${err.message ? " · " + err.message : ""}`;
  }
  return err?.message || String(err);
}

export async function chatWithFailover({
  settings,
  messages,
  system = "",
  temperature = 0.7,
  maxTokens = 1200,
  onEvent,
  onToken,
  signal,
}) {
  const chain = buildChain(settings);
  if (!chain.length) {
    throw new Error("No free route is available. Enable the keyless fallback or add a free key in settings.");
  }

  const failures = [];
  for (const provider of chain) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const models = await resolveModels(provider, settings);
    if (!models.length) {
      failures.push({ provider: provider.short, error: "no model configured" });
      onEvent?.({ type: "fail", provider, error: "no model configured" });
      continue;
    }
    let skipProvider = false;
    for (const model of models) {
      if (!model || skipProvider) continue;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const started = performance.now();
      onEvent?.({ type: "try", provider, model });
      try {
        const result = await callProvider(provider, model, {
          messages,
          system,
          temperature,
          maxTokens,
          onToken,
          signal,
          settings,
        });
        const ms = Math.round(performance.now() - started);
        onEvent?.({ type: "ok", provider, model, ms });
        return { ...result, provider, model, ms };
      } catch (err) {
        if (signal?.aborted || err?.name === "AbortError" && signal?.aborted) throw err;
        const message = friendly(err);
        failures.push({ provider: provider.short, model, error: message });
        onEvent?.({ type: "fail", provider, model, error: message });
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          skipProvider = true;
        }
      }
    }
  }

  const summary = failures
    .filter((f, i, arr) => arr.findIndex((x) => x.provider === f.provider) === i)
    .slice(0, 4)
    .map((f) => `${f.provider}: ${f.error}`)
    .join(" · ");
  const error = new Error(
    "All free routes failed." + (summary ? " " + summary + "." : "") + " Add a free key in settings for more headroom."
  );
  error.failures = failures;
  throw error;
}

export async function generate({ settings, prompt, system = "", maxTokens = 900, temperature = 0.4, signal, onEvent }) {
  const result = await chatWithFailover({
    settings,
    messages: [{ role: "user", content: prompt }],
    system,
    temperature,
    maxTokens,
    onEvent,
    signal,
  });
  return result;
}

export async function testRoute(providerId, settings) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return { id: providerId, ok: false, error: "unknown provider" };
  if (!isReady(provider, settings)) {
    return { id: providerId, label: provider.short, ok: false, error: "not configured" };
  }
  const started = performance.now();
  try {
    const models = await resolveModels(provider, settings);
    const model = models[0];
    const res = await callProvider(provider, model, {
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      system: "",
      temperature: 0,
      maxTokens: 64,
      stream: false,
      settings,
    });
    return {
      id: providerId,
      label: provider.short,
      ok: Boolean(res.text),
      model,
      ms: Math.round(performance.now() - started),
      error: res.text ? "" : "empty response",
    };
  } catch (err) {
    return {
      id: providerId,
      label: provider.short,
      ok: false,
      ms: Math.round(performance.now() - started),
      error: friendly(err),
    };
  }
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}
