import {
  AGENTS,
  AGENT_ORDER,
  SQUAD,
  QUICK_PROMPTS,
  baseSystem,
  pickAgent,
} from "./config.js";
import { store, newChat, titleFromText, uid } from "./store.js";
import { renderMarkdown, stripMarkdown, escapeHtml } from "./markdown.js";
import {
  chatWithFailover,
  providerStatus,
  buildChain,
  testRoute,
  estimateTokens,
} from "./ai.js";
import {
  fetchRepoBundle,
  buildAnalysisPrompt,
  ANALYSIS_SYSTEM,
  formatNumber,
  timeAgo,
} from "./github.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const urlParams = new URLSearchParams(location.search);
const isEmbed = urlParams.get("embed") === "1";

const state = {
  settings: store.settings(),
  activeChat: null,
  controller: null,
  busy: false,
  analyzing: false,
  speaking: false,
  lastRoute: null,
  lastReport: null,
  recognition: null,
  listening: false,
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const ICON = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

function toast(message, isError = false) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("err", Boolean(isError));
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3400);
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function truncate(text, n) {
  const s = String(text || "");
  return s.length > n ? s.slice(0, n) + "\n\n[truncated]" : s;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}

function activeAgentId() {
  return state.activeChat?.agent || state.settings.defaultAgent || "auto";
}

function isSquad() {
  return Boolean($("#squadToggle")?.checked);
}

/* ------------------------------------------------------------------ */
/* navigation                                                          */
/* ------------------------------------------------------------------ */

const VIEWS = ["home", "console", "agents", "analyzer", "docs"];

function showView(view) {
  VIEWS.forEach((v) => {
    const el = $("#view-" + v);
    if (el) el.hidden = v !== view;
  });
  $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === view));
  document.body.classList.toggle("in-console", view === "console");
  closeMobileMenu();
  if (view !== "console") {
    const side = $("#sidePanel");
    if (side) side.classList.remove("open");
  }
}

function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) {
    showView("home");
    return;
  }
  if (raw.startsWith("doc-")) {
    showView("docs");
    requestAnimationFrame(() => {
      const el = document.getElementById(raw);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return;
  }
  const view = VIEWS.includes(raw) ? raw : "home";
  showView(view);
  if (view === "console") {
    ensureChat();
    renderChat();
    setTimeout(() => $("#input")?.focus(), 80);
  }
  if (view === "home") window.scrollTo({ top: 0, behavior: "auto" });
}

function closeMobileMenu() {
  const menu = $("#mobileMenu");
  if (menu) menu.hidden = true;
  $("#menuBtn")?.setAttribute("aria-expanded", "false");
}

/* ------------------------------------------------------------------ */
/* chat state                                                          */
/* ------------------------------------------------------------------ */

function ensureChat() {
  if (!state.activeChat) {
    const savedId = store.activeId();
    state.activeChat = (savedId && store.getChat(savedId)) || newChat(state.settings.defaultAgent);
    store.setActiveId(state.activeChat.id);
  }
  if ($("#agentSelect")) $("#agentSelect").value = activeAgentId();
  if ($("#squadToggle")) $("#squadToggle").checked = Boolean(state.activeChat.squad);
}

function persist() {
  if (!state.activeChat) return;
  state.activeChat.updatedAt = Date.now();
  store.upsertChat(state.activeChat);
}

function startNewChat() {
  if (state.busy) {
    toast("Stop the current run first.", true);
    return;
  }
  if (state.activeChat && state.activeChat.messages.length === 0) {
    $("#input")?.focus();
    return;
  }
  const chat = newChat(state.settings.defaultAgent);
  state.activeChat = chat;
  store.setActiveId(chat.id);
  state.lastRoute = null;
  $("#sidePanel")?.classList.remove("open");
  renderChat();
  updateModelChip();
  $("#input")?.focus();
}

function openChat(id) {
  if (state.busy) {
    toast("Stop the current run first.", true);
    return;
  }
  const chat = store.getChat(id);
  if (!chat) return;
  state.activeChat = chat;
  store.setActiveId(id);
  state.lastRoute = null;
  $("#sidePanel")?.classList.remove("open");
  renderChat();
  updateModelChip();
}

/* ------------------------------------------------------------------ */
/* message rendering                                                   */
/* ------------------------------------------------------------------ */

function renderChat() {
  ensureChat();
  const chat = state.activeChat;
  const messagesEl = $("#messages");
  if (!messagesEl) return;

  $("#chatTitle").textContent = chat.title || "New session";
  $("#chatMeta").textContent = `${chat.messages.length} message${chat.messages.length === 1 ? "" : "s"} · ${AGENTS[activeAgentId()]?.name || "ASHK Auto"}${isSquad() ? " · squad" : ""}`;

  if (!chat.messages.length) {
    messagesEl.innerHTML = emptyState();
  } else {
    messagesEl.innerHTML =
      `<div class="messages-inner">${chat.messages.map(messageHtml).join("")}</div>`;
  }
  renderChatList();
  renderSessionStats();
  updateModelChip();
  if (chat.messages.length) scrollBottom();
  else {
    const box = $("#messages");
    if (box) box.scrollTop = 0;
  }
}

function emptyState() {
  return `<div class="empty-state">
    <div class="empty-orb">${ICON("spark")}</div>
    <h3>What should ASHK do?</h3>
    <p>Ask anything, paste code, or start a squad run for a hard problem. The free route is already live — no key needed.</p>
    <div class="prompt-grid">
      ${QUICK_PROMPTS.slice(0, 4)
        .map((p) => `<button type="button" data-prompt="${escapeAttr(p)}">${escapeHtml(p)}</button>`)
        .join("")}
    </div>
  </div>`;
}

function messageHtml(msg) {
  if (msg.role === "error") {
    return `<div class="msg-error" id="msg-${msg.id}">${escapeHtml(msg.content)}</div>`;
  }
  if (msg.role === "user") {
    return `<div class="msg user" id="msg-${msg.id}">
      <div class="msg-avatar">Y</div>
      <div class="msg-body">
        <div class="msg-head"><span class="msg-name">You</span><span class="msg-badge">${fmtTime(msg.at)}</span></div>
        <div class="user-bubble">${escapeHtml(msg.content)}</div>
      </div>
    </div>`;
  }

  const steps = Array.isArray(msg.steps) && msg.steps.length ? msg.steps : null;
  const chips = steps
    ? `<div class="squad-inline" data-steps="${msg.id}">${steps
        .map(
          (s) =>
            `<span class="squad-chip ${s.status === "done" ? "done" : s.status === "active" ? "active" : s.status === "fail" ? "fail" : ""}"><span class="dot"></span>${escapeHtml(s.label)}</span>`
        )
        .join("")}</div>`
    : "";
  const providerBadge = msg.provider
    ? `<span class="msg-badge provider">${escapeHtml(msg.provider)}${msg.model ? " · " + escapeHtml(msg.model) : ""}</span>`
    : "";
  const msBadge = msg.ms ? `<span class="msg-badge">${(msg.ms / 1000).toFixed(1)}s</span>` : "";
  const body = msg.content
    ? renderMarkdown(msg.content)
    : `<span class="typing"><i></i><i></i><i></i></span>`;

  const isLastAssistant =
    state.activeChat?.messages[state.activeChat.messages.length - 1]?.id === msg.id;
  const actions = `<div class="msg-actions">
    ${msg.content ? `<button class="action-btn" data-action="copy" data-id="${msg.id}">${ICON("copy")} Copy</button>` : ""}
    ${msg.content ? `<button class="action-btn" data-action="speak" data-id="${msg.id}">${ICON("bolt")} Speak</button>` : ""}
    ${isLastAssistant && !state.busy ? `<button class="action-btn" data-action="regen" data-id="${msg.id}">${ICON("refresh")} Regenerate</button>` : ""}
  </div>`;

  return `<div class="msg assistant" id="msg-${msg.id}">
    <div class="msg-avatar">A</div>
    <div class="msg-body">
      <div class="msg-head">
        <span class="msg-name">${escapeHtml(msg.agentName || "ASHK")}</span>
        ${providerBadge}${msBadge}
        <span class="msg-badge">${fmtTime(msg.at)}</span>
      </div>
      ${chips}
      <div class="assistant-card ${msg.streaming ? "streaming" : ""}">
        <div class="markdown" data-md="${msg.id}">${body}</div>
      </div>
      ${actions}
    </div>
  </div>`;
}

function renderChatList() {
  const wrap = $("#chatList");
  if (!wrap) return;
  const chats = store
    .chats()
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!chats.length) {
    wrap.innerHTML = `<div class="chat-item"><span class="chat-item-meta">No saved sessions yet.</span></div>`;
    return;
  }
  wrap.innerHTML = chats
    .map(
      (c) => `<button class="chat-item ${c.id === state.activeChat?.id ? "active" : ""}" data-chat="${c.id}">
        <span class="chat-item-title">${escapeHtml(c.title || "New session")}</span>
        <span class="chat-item-meta">${escapeHtml(AGENTS[c.agent]?.short || "Auto")} · ${timeAgo(new Date(c.updatedAt || c.createdAt).toISOString())}</span>
      </button>`
    )
    .join("");
}

function renderSessionStats() {
  const box = $("#sessionStats");
  if (!box) return;
  const msgs = state.activeChat?.messages || [];
  const tokens = msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const route = state.lastRoute ? `${state.lastRoute.provider} · ${state.lastRoute.model}` : "—";
  box.innerHTML = `
    <div><span>Messages</span><b>${msgs.length}</b></div>
    <div><span>Tokens est.</span><b>${tokens >= 1000 ? (tokens / 1000).toFixed(1) + "k" : tokens}</b></div>
    <div><span>Route</span><b title="${escapeAttr(route)}">${escapeHtml(route)}</b></div>`;
}

function scrollBottom() {
  const el = $("#messages");
  if (el) el.scrollTop = el.scrollHeight;
}

function updateMessageDom(msg) {
  const target = document.querySelector(`[data-md="${msg.id}"]`);
  if (target) {
    target.innerHTML = renderMarkdown(msg.content) + (msg.streaming ? `<span class="stream-caret"></span>` : "");
  }
  const card = target?.closest(".assistant-card");
  if (card) card.classList.toggle("streaming", Boolean(msg.streaming));
  const chips = document.querySelector(`[data-steps="${msg.id}"]`);
  if (chips && msg.steps) {
    chips.innerHTML = msg.steps
      .map(
        (s) =>
          `<span class="squad-chip ${s.status === "done" ? "done" : s.status === "active" ? "active" : s.status === "fail" ? "fail" : ""}"><span class="dot"></span>${escapeHtml(s.label)}</span>`
      )
      .join("");
  }
  scrollBottom();
}

/* ------------------------------------------------------------------ */
/* provider chain UI                                                   */
/* ------------------------------------------------------------------ */

function renderChain() {
  const wrap = $("#chainList");
  if (!wrap) return;
  const list = providerStatus(state.settings);
  wrap.innerHTML = list
    .map(
      (p) => `<div class="chain-item ${p.ready ? "" : "disabled"}" data-provider="${p.id}" title="${escapeAttr(p.ready ? p.note : "Add a free key in settings")}">
        <span class="dot"></span>
        <span class="label">${escapeHtml(p.label)}</span>
        <span class="model">${escapeHtml(p.ready ? p.model : "add key")}</span>
      </div>`
    )
    .join("");

  const ready = list.filter((p) => p.ready).length;
  const routeState = $("#routeState");
  if (routeState && !state.busy) {
    routeState.className = "run-live" + (ready ? " ok" : " err");
    routeState.innerHTML = `<span class="dot"></span> ${ready === 1 ? "1 route" : ready ? ready + " routes" : "no route"}`;
  }
  updateModelChip();
}

function setChainState(providerId, status) {
  const el = document.querySelector(`.chain-item[data-provider="${providerId}"]`);
  if (!el) return;
  el.classList.remove("active", "ok", "fail");
  if (status) el.classList.add(status);
}

function resetChainStates() {
  $$(".chain-item").forEach((el) => el.classList.remove("active", "ok", "fail"));
}

function setRouteState(kind, label) {
  const el = $("#routeState");
  if (!el) return;
  el.className = "run-live " + kind;
  el.innerHTML = `<span class="dot"></span> ${escapeHtml(label)}`;
}

function handleRouteEvent(ev) {
  if (!ev) return;
  if (ev.type === "try") {
    setChainState(ev.provider.id, "active");
    setRouteState("live", "routing");
    $("#composerHint").textContent = `Trying ${ev.provider.short} · ${ev.model}`;
  } else if (ev.type === "ok") {
    setChainState(ev.provider.id, "ok");
    setRouteState("ok", "answered");
    state.lastRoute = { provider: ev.provider.short, model: ev.model, ms: ev.ms };
    const chip = $("#modelChip");
    if (chip) {
      chip.className = "chip live";
      chip.innerHTML = `<span class="dot"></span> ${escapeHtml(ev.provider.short)} · ${escapeHtml(ev.model)}`;
    }
    $("#composerHint").textContent = `Answered by ${ev.provider.short} in ${(ev.ms / 1000).toFixed(1)}s`;
    renderSessionStats();
  } else if (ev.type === "fail") {
    setChainState(ev.provider.id, "fail");
    $("#composerHint").textContent = `Failover: ${ev.provider.short} — ${ev.error}`;
  }
}

function updateModelChip() {
  const chip = $("#modelChip");
  if (!chip) return;
  if (state.lastRoute) {
    chip.className = "chip live";
    chip.innerHTML = `<span class="dot"></span> ${escapeHtml(state.lastRoute.provider)} · ${escapeHtml(state.lastRoute.model)}`;
    return;
  }
  const ready = buildChain(state.settings).length;
  chip.className = "chip" + (ready ? "" : " warn");
  chip.innerHTML = `<span class="dot"></span> ${ready === 1 ? "1 route configured" : ready + " routes configured"}`;
}

/* ------------------------------------------------------------------ */
/* send + streaming                                                    */
/* ------------------------------------------------------------------ */

function buildHistory(limit = 14) {
  return (state.activeChat?.messages || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: truncate(m.content, 6000) }));
}

async function sendMessage(text) {
  const task = String(text || "").trim();
  if (state.analyzing) {
    toast("Wait for the repository analysis to finish.", true);
    return;
  }
  if (!task || state.busy) return;
  ensureChat();
  const chat = state.activeChat;

  chat.messages.push({ id: uid("m"), role: "user", content: task, at: Date.now() });
  if (chat.messages.filter((m) => m.role === "user").length === 1) {
    chat.title = titleFromText(task);
  }
  persist();
  $("#input").value = "";
  autoGrow($("#input"));
  renderChat();
  await runAssistant(task);
}

async function runAssistant(task) {
  const chat = state.activeChat;
  if (!chat) return;

  const agentId = chat.agent === "auto" ? pickAgent(task) : chat.agent;
  const agent = AGENTS[agentId] || AGENTS.auto;
  const squad = isSquad();

  const msg = {
    id: uid("m"),
    role: "assistant",
    content: "",
    at: Date.now(),
    agent: agentId,
    agentName: squad ? "ASHK Squad" : agent.name,
    provider: "",
    model: "",
    streaming: true,
    steps: squad ? SQUAD.map((s) => ({ key: s.key, label: s.label, status: "pending", ms: 0 })) : null,
  };
  chat.messages.push(msg);
  persist();
  renderChat();
  setBusy(true);
  resetChainStates();

  state.controller = new AbortController();
  const outer = state.controller.signal;

  let frame = 0;
  const paint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      updateMessageDom(msg);
    });
  };

  const history = buildHistory();
  const onToken = (delta, full) => {
    msg.content = full;
    msg.streaming = true;
    paint();
  };
  const onEvent = (ev) => handleRouteEvent(ev);

  try {
    if (squad) {
      await runSquad(task, msg, outer, onToken, onEvent);
    } else {
      const result = await chatWithFailover({
        settings: state.settings,
        messages: history,
        system: baseSystem() + "\n\n" + agent.prompt,
        temperature: agent.temp ?? state.settings.temperature,
        maxTokens: Number(state.settings.maxTokens) || 1200,
        onToken,
        onEvent,
        signal: outer,
      });
      msg.content = result.text;
      msg.provider = result.provider.short;
      msg.model = result.model;
      msg.ms = result.ms;
      msg.agentName = agent.name;
    }
    msg.streaming = false;
    msg.at = Date.now();
    persist();
    renderChat();
    if (state.settings.speakReplies) speak(stripMarkdown(msg.content));
  } catch (err) {
    msg.streaming = false;
    if (outer.aborted) {
      if (!msg.content) msg.content = "_Stopped._";
      else msg.content += "\n\n_Stopped._";
      msg.provider = state.lastRoute?.provider || msg.provider;
      persist();
      renderChat();
    } else {
      if (msg.content) {
        msg.content += `\n\n> Route error: ${err.message}`;
        persist();
        renderChat();
        toast("Every free route failed. Add a key in settings.", true);
      } else {
        chat.messages = chat.messages.filter((m) => m.id !== msg.id);
        chat.messages.push({ id: uid("e"), role: "error", content: err.message, at: Date.now() });
        persist();
        renderChat();
        toast("Every free route failed.", true);
      }
      setRouteState("err", "all failed");
    }
  } finally {
    state.controller = null;
    setBusy(false);
    renderChat();
    $("#input")?.focus();
  }
}

async function runSquad(task, msg, signal, onToken, onEvent) {
  const outputs = {};
  const maxTokens = Number(state.settings.maxTokens) || 1200;

  for (const step of SQUAD) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const meta = msg.steps.find((s) => s.key === step.key);
    if (meta) meta.status = "active";
    updateMessageDom(msg);
    renderTimeline(msg);

    const agent = AGENTS[step.agent];
    const parts = [`TASK:\n${task}`];
    if (outputs.plan) parts.push(`PLAN:\n${truncate(outputs.plan, 4000)}`);
    if (outputs.work) parts.push(`WORK PRODUCT:\n${truncate(outputs.work, 7000)}`);
    if (outputs.critique) parts.push(`CRITIQUE:\n${truncate(outputs.critique, 3500)}`);
    parts.push(`INSTRUCTION:\n${step.instruction}`);

    const limit =
      step.key === "final" ? Math.max(1600, maxTokens) : step.key === "work" ? Math.max(1200, maxTokens) : 900;

    try {
      const result = await chatWithFailover({
        settings: state.settings,
        messages: [{ role: "user", content: parts.join("\n\n") }],
        system: baseSystem() + "\n\n" + agent.prompt,
        temperature: agent.temp ?? 0.5,
        maxTokens: limit,
        onToken: step.key === "final" ? onToken : undefined,
        onEvent,
        signal,
      });
      outputs[step.key] = result.text;
      if (meta) {
        meta.status = "done";
        meta.ms = result.ms;
      }
      if (step.key === "final") {
        msg.content = result.text;
        msg.provider = result.provider.short;
        msg.model = result.model;
        msg.ms = result.ms;
      } else if (!msg.provider) {
        msg.provider = result.provider.short;
        msg.model = result.model;
      }
    } catch (err) {
      if (signal.aborted) throw err;
      if (meta) {
        meta.status = "fail";
        meta.error = err.message;
      }
      if (step.key === "final") throw err;
    } finally {
      updateMessageDom(msg);
      renderTimeline(msg);
    }
  }

  msg.streaming = false;
  if (!msg.content && outputs.final) msg.content = outputs.final;
}

function renderTimeline(msg) {
  const list = $("#squadSteps");
  if (!list) return;
  if (!msg?.steps?.length) {
    list.innerHTML = `<li class="timeline-empty">Enable squad mode for plan → build → critique → final.</li>`;
    return;
  }
  list.innerHTML = msg.steps
    .map(
      (s) => `<li class="${s.status}"><b>${escapeHtml(s.label)}</b><small>${escapeHtml(
        s.status === "pending" ? "queued" : s.status === "active" ? "running…" : s.status === "done" ? `${(s.ms / 1000).toFixed(1)}s` : s.error || "failed"
      )}</small></li>`
    )
    .join("");
}

function setBusy(busy) {
  state.busy = busy;
  $("#sendBtn").disabled = busy;
  $("#stopBtn").hidden = !busy;
  $("#input").disabled = false;
  if (!busy) {
    resetUIHints();
  } else {
    setRouteState("live", "working");
  }
  renderChatList();
}

function resetUIHints() {
  const ready = buildChain(state.settings).length;
  $("#composerHint").textContent = ready ? "Free route · auto-failover" : "No route · add a free key";
  if (ready) setRouteState("ok", "standby");
}

/* ------------------------------------------------------------------ */
/* regenerate / copy / speak                                           */
/* ------------------------------------------------------------------ */

async function regenerate() {
  if (state.busy) return;
  const msgs = state.activeChat?.messages || [];
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return;
  const task = msgs[lastUser].content;
  state.activeChat.messages = msgs.slice(0, lastUser + 1);
  persist();
  renderChat();
  await runAssistant(task);
}

function copyText(text) {
  const done = () => toast("Copied.");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    toast("Copy failed.", true);
  }
  ta.remove();
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    toast("Speech is not supported in this browser.", true);
    return;
  }
  if (state.speaking) {
    speechSynthesis.cancel();
    state.speaking = false;
    return;
  }
  const clean = stripMarkdown(text).slice(0, 5000);
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = /[\u0900-\u097F]/.test(clean) ? "hi-IN" : "en-IN";
  u.rate = 1;
  u.onend = () => {
    state.speaking = false;
  };
  u.onerror = () => {
    state.speaking = false;
  };
  state.speaking = true;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function exportChat() {
  const chat = state.activeChat;
  if (!chat || !chat.messages.length) {
    toast("Nothing to export yet.", true);
    return;
  }
  const body = chat.messages
    .filter((m) => m.role !== "error")
    .map((m) => (m.role === "user" ? `## You\n\n${m.content}` : `## ${m.agentName || "ASHK"}\n\n${m.content}`))
    .join("\n\n---\n\n");
  const md = `# ${chat.title}\n\n_Exported from ASHK.AI · ${new Date().toLocaleString()}_\n\n${body}\n`;
  const blob = new Blob([md], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (chat.title || "ashk-session").replace(/[^\w.-]+/g, "-").slice(0, 40) + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Session exported.");
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

function fillSettings() {
  const s = state.settings;
  $("#kGemini").value = s.keys.gemini || "";
  $("#kGroq").value = s.keys.groq || "";
  $("#kOpenRouter").value = s.keys.openrouter || "";
  $("#kGithub").value = s.keys.github || "";
  $("#cBase").value = s.custom.base || "";
  $("#cModel").value = s.custom.model || "";
  $("#cKey").value = s.custom.key || "";
  $("#wUrl").value = s.worker.url || "";
  $("#wKey").value = s.worker.key || "";
  $("#defAgent").value = s.defaultAgent || "auto";
  $("#maxTokens").value = s.maxTokens || 1200;
  $("#temperature").value = s.temperature ?? 0.7;
  $("#tempVal").textContent = Number(s.temperature ?? 0.7).toFixed(1);
  $("#allowKeyless").checked = Boolean(s.allowKeyless);
  $("#speakReplies").checked = Boolean(s.speakReplies);
  $("#testResults").innerHTML = "";
}

function openSettings() {
  fillSettings();
  const dlg = $("#settingsDlg");
  if (dlg && !dlg.open) dlg.showModal();
  closeMobileMenu();
}

function saveSettingsFromForm() {
  state.settings = store.saveSettings({
    keys: {
      gemini: $("#kGemini").value.trim(),
      groq: $("#kGroq").value.trim(),
      openrouter: $("#kOpenRouter").value.trim(),
      github: $("#kGithub").value.trim(),
    },
    custom: {
      base: $("#cBase").value.trim(),
      model: $("#cModel").value.trim(),
      key: $("#cKey").value.trim(),
    },
    worker: {
      url: $("#wUrl").value.trim(),
      key: $("#wKey").value.trim(),
    },
    defaultAgent: $("#defAgent").value,
    maxTokens: Math.max(256, Math.min(8192, Number($("#maxTokens").value) || 1200)),
    temperature: Number($("#temperature").value),
    allowKeyless: $("#allowKeyless").checked,
    speakReplies: $("#speakReplies").checked,
  });
  renderChain();
  resetUIHints();
  const dlg = $("#settingsDlg");
  if (dlg?.open) dlg.close();
  toast("Settings saved locally.");
}

async function runProviderTests() {
  const box = $("#testResults");
  if (!box) return;
  const ready = providerStatus(state.settings).filter((p) => p.ready);
  if (!ready.length) {
    box.innerHTML = `<div class="test-row fail"><span class="dot"></span>No route configured.</div>`;
    return;
  }
  box.innerHTML = "";
  for (const p of ready) {
    const row = document.createElement("div");
    row.className = "test-row";
    row.innerHTML = `<span class="dot"></span>${escapeHtml(p.label)}<span class="msg-badge">${escapeHtml(p.model)}</span><span class="time">testing…</span>`;
    box.appendChild(row);
    const result = await testRoute(p.id, state.settings);
    row.className = "test-row " + (result.ok ? "ok" : "fail");
    row.innerHTML = `<span class="dot"></span>${escapeHtml(result.label || p.label)}<span class="msg-badge">${escapeHtml(result.model || p.model)}</span><span class="time">${escapeHtml(result.ok ? result.ms + " ms" : result.error)}</span>`;
  }
}

function clearData() {
  if (!confirm("Clear all ASHK data in this browser? This deletes chats, keys and settings.")) return;
  store.clearAll();
  state.settings = store.settings();
  state.activeChat = newChat("auto");
  store.setActiveId(state.activeChat.id);
  state.lastRoute = null;
  fillSettings();
  renderChain();
  renderChat();
  const dlg = $("#settingsDlg");
  if (dlg?.open) dlg.close();
  toast("Local data cleared.");
}

/* ------------------------------------------------------------------ */
/* analyzer                                                            */
/* ------------------------------------------------------------------ */

function analyzerStatus(message, isError = false) {
  const el = $("#analyzerStatus");
  if (!el) return;
  el.hidden = false;
  el.className = "analyzer-status" + (isError ? " error" : "");
  el.innerHTML = `<span class="dot"></span><span>${escapeHtml(message)}</span>`;
}

function analyzerReportHtml(bundle, aiText) {
  const r = bundle.repo;
  const s = bundle.scores;
  const dimNames = {
    substance: "Substance",
    architecture: "Architecture",
    documentation: "Docs",
    activity: "Activity",
    security: "Security",
    usability: "Usability",
    maintenance: "Maintenance",
    popularity: "Popularity",
  };
  const scoreCards = Object.entries(s.dims)
    .filter(([k]) => dimNames[k])
    .map(
      ([k, v]) => `<div class="score-card"><span>${dimNames[k]}<b>${v.toFixed(1)}</b></span><div class="meter"><i style="width:${v * 10}%"></i></div></div>`
    )
    .join("");

  return `<div class="report-head">
      <div class="report-repo">
        <div class="report-icon">${ICON("github")}</div>
        <div>
          <h3>${escapeHtml(bundle.parsed.full)} <a href="${escapeAttr(r.html_url)}" target="_blank" rel="noopener" title="Open on GitHub">${ICON("external")}</a></h3>
          <p>${escapeHtml(r.description || "No description provided.")}</p>
        </div>
      </div>
      <div>
        <div class="score-big"><b>${s.overall}</b><span>/100 local score</span></div>
        <p class="muted" style="font-size:11px;text-align:right">computed from public signals</p>
      </div>
    </div>
    <div class="score-grid">${scoreCards}</div>
    <div class="report-meta">
      <span><span class="dot"></span>${formatNumber(r.stargazers_count)} stars</span>
      <span><span class="dot"></span>${formatNumber(r.forks_count)} forks</span>
      <span><span class="dot"></span>${escapeHtml(r.license?.spdx_id || "no license")}</span>
      <span><span class="dot"></span>updated ${timeAgo(r.pushed_at)}</span>
      ${bundle.langPct[0] ? `<span><span class="dot"></span>${escapeHtml(bundle.langPct[0].name)} ${bundle.langPct[0].pct}%</span>` : ""}
      ${r.archived ? `<span style="color:var(--amber)"><span class="dot"></span>archived</span>` : ""}
    </div>
    <div class="report-ai markdown">${renderMarkdown(aiText)}</div>
    <div class="msg-actions" style="margin-top:16px">
      <button class="action-btn" data-report-action="copy">${ICON("copy")} Copy report</button>
      <a class="action-btn" href="${escapeAttr(r.html_url)}" target="_blank" rel="noopener">${ICON("external")} Open repository</a>
      <button class="action-btn" data-report-action="chat">${ICON("spark")} Ask in console</button>
    </div>`;
}

async function analyzeRepo(event) {
  event.preventDefault();
  if (state.busy) {
    toast("Wait for the current run to finish.", true);
    return;
  }
  const input = $("#repoInput").value.trim();
  if (!input) {
    analyzerStatus("Enter a repository first.", true);
    return;
  }

  const btn = $("#analyzeBtn");
  const result = $("#analyzerResult");
  state.analyzing = true;
  btn.disabled = true;
  btn.dataset.label = btn.innerHTML;
  btn.innerHTML = `${ICON("refresh")} Analyzing…`;
  result.hidden = true;
  analyzerStatus("Fetching repository metadata from the public GitHub API…");

  try {
    const bundle = await fetchRepoBundle(input, state.settings.keys.github);
    if (!bundle.readme) analyzerStatus("Repository loaded. README missing — the review will rely on structure and metadata.");
    else analyzerStatus(`Loaded ${bundle.parsed.full}. Writing the deep review with the free router…`);

    const ai = await chatWithFailover({
      settings: state.settings,
      messages: [{ role: "user", content: buildAnalysisPrompt(bundle) }],
      system: ANALYSIS_SYSTEM,
      temperature: 0.35,
      maxTokens: 1800,
      onEvent: (ev) => {
        if (ev.type === "try") analyzerStatus(`Trying ${ev.provider.short} · ${ev.model}…`);
        else if (ev.type === "fail") analyzerStatus(`${ev.provider.short} failed (${ev.error}). Failing over…`);
        else if (ev.type === "ok") analyzerStatus(`${ev.provider.short} answered in ${(ev.ms / 1000).toFixed(1)}s. Rendering report…`);
      },
    });

    state.lastReport = {
      repo: bundle.parsed.full,
      text: ai.text,
      local: bundle.scores,
      provider: `${ai.provider.short} · ${ai.model}`,
    };

    result.innerHTML = analyzerReportHtml(bundle, ai.text);
    result.hidden = false;
    analyzerStatus(`Deep analysis complete · ${ai.provider.short} · ${ai.model} · ${(ai.ms / 1000).toFixed(1)}s`);
    result.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#analyzerStatus").hidden = false;
  } catch (err) {
    analyzerStatus(err.message || String(err), true);
    toast("Analysis failed.", true);
  } finally {
    state.analyzing = false;
    btn.disabled = false;
    btn.innerHTML = btn.dataset.label || `${ICON("spark")} Run deep analysis`;
  }
}

/* ------------------------------------------------------------------ */
/* voice input                                                         */
/* ------------------------------------------------------------------ */

function startDictation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast("Voice input needs Chrome or Edge.", true);
    return;
  }
  if (state.listening) {
    state.recognition?.stop();
    return;
  }
  const rec = new SR();
  rec.lang = /^hi/i.test(navigator.language) ? "hi-IN" : "en-IN";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  const input = $("#input");
  const base = input.value;

  rec.onstart = () => {
    state.listening = true;
    $("#micBtn").classList.add("live");
    $("#composerHint").textContent = "Listening… speak now";
  };
  rec.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    input.value = (base ? base.trim() + " " : "") + transcript.trim();
    autoGrow(input);
  };
  rec.onerror = (event) => {
    if (event.error !== "aborted") toast("Mic error: " + event.error, true);
  };
  rec.onend = () => {
    state.listening = false;
    state.recognition = null;
    $("#micBtn").classList.remove("live");
    resetUIHints();
    input.focus();
  };
  state.recognition = rec;
  try {
    rec.start();
  } catch {
    state.listening = false;
    toast("Could not start the microphone.", true);
  }
}

/* ------------------------------------------------------------------ */
/* input helpers                                                       */
/* ------------------------------------------------------------------ */

function autoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

function bind() {
  window.addEventListener("hashchange", route);
  $("#year").textContent = new Date().getFullYear();

  $("#menuBtn")?.addEventListener("click", () => {
    const menu = $("#mobileMenu");
    const open = menu.hidden;
    menu.hidden = !open;
    $("#menuBtn").setAttribute("aria-expanded", String(open));
  });

  $("#settingsBtn")?.addEventListener("click", openSettings);
  $("#mobileSettingsBtn")?.addEventListener("click", openSettings);
  $("#sideSettings")?.addEventListener("click", openSettings);
  $("#runSettings")?.addEventListener("click", openSettings);
  $("#settingsForm")?.addEventListener("submit", (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    saveSettingsFromForm();
  });
  $("#temperature")?.addEventListener("input", (e) => {
    $("#tempVal").textContent = Number(e.target.value).toFixed(1);
  });
  $("#testProviders")?.addEventListener("click", runProviderTests);
  $("#clearData")?.addEventListener("click", clearData);

  $("#newChat")?.addEventListener("click", startNewChat);
  $("#exportChat")?.addEventListener("click", exportChat);
  $("#sideToggle")?.addEventListener("click", () => $("#sidePanel")?.classList.toggle("open"));
  $("#sideAnalyzer")?.addEventListener("click", () => {
    location.hash = "#/analyzer";
  });

  $("#chatList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-chat]");
    if (btn) openChat(btn.dataset.chat);
  });

  $("#agentSelect")?.addEventListener("change", (e) => {
    ensureChat();
    state.activeChat.agent = e.target.value;
    persist();
    renderChat();
    toast(`Agent: ${AGENTS[e.target.value]?.name || "Auto"}`);
  });
  $("#squadToggle")?.addEventListener("change", (e) => {
    ensureChat();
    state.activeChat.squad = e.target.checked;
    persist();
    renderChat();
    if (e.target.checked) {
      $("#squadSteps").innerHTML = `<li class="timeline-empty">Squad will run plan → build → critique → final.</li>`;
      toast("Squad mode on: four agents, about 4x tokens.");
    } else {
      renderTimeline(null);
    }
  });

  $("#composer")?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage($("#input").value);
  });
  $("#input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("#composer").requestSubmit();
    }
  });
  $("#input")?.addEventListener("input", (e) => autoGrow(e.target));
  $("#stopBtn")?.addEventListener("click", () => {
    state.controller?.abort();
    toast("Stopping…");
  });
  $("#micBtn")?.addEventListener("click", startDictation);

  $("#messages")?.addEventListener("click", (e) => {
    const prompt = e.target.closest("[data-prompt]");
    if (prompt) {
      sendMessage(prompt.dataset.prompt);
      return;
    }
    const action = e.target.closest("[data-action]");
    if (!action) return;
    const msg = state.activeChat?.messages.find((m) => m.id === action.dataset.id);
    if (!msg) return;
    if (action.dataset.action === "copy") copyText(msg.content);
    if (action.dataset.action === "speak") speak(msg.content);
    if (action.dataset.action === "regen") regenerate();
  });

  $("#quickPrompts")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-prompt]");
    if (btn) sendMessage(btn.dataset.prompt);
  });

  $("#repoForm")?.addEventListener("submit", analyzeRepo);
  $("#repoExamples")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-repo]");
    if (btn) {
      $("#repoInput").value = btn.dataset.repo;
      $("#repoInput").focus();
    }
  });
  $("#analyzerResult")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-report-action]");
    if (!btn) return;
    if (btn.dataset.reportAction === "copy") copyText(state.lastReport?.text || "");
    if (btn.dataset.reportAction === "chat") {
      location.hash = "#/console";
      setTimeout(() => {
        $("#input").value = state.lastReport ? `Review the repository ${state.lastReport.repo} like a senior engineer. Focus on red flags and next steps.` : "";
        autoGrow($("#input"));
        $("#input").focus();
      }, 120);
    }
  });

  $("#chainList")?.addEventListener("click", (e) => {
    const item = e.target.closest(".chain-item.disabled");
    if (item) openSettings();
  });

  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (location.hash !== "#/console") location.hash = "#/console";
      else startNewChat();
    }
    if (e.key === "Escape") {
      $("#sidePanel")?.classList.remove("open");
      closeMobileMenu();
    }
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function updateNet() {
  const pill = $("#netPill");
  if (!pill) return;
  const online = navigator.onLine;
  pill.classList.toggle("offline", !online);
  $("#netText").textContent = online ? "Online" : "Offline";
}

function init() {
  if (isEmbed) document.body.classList.add("embed");
  state.settings = store.settings();
  ensureChat();
  if ($("#agentSelect")) {
    $("#agentSelect").innerHTML = AGENT_ORDER.map(
      (id) => `<option value="${id}">${escapeHtml(AGENTS[id].name)}</option>`
    ).join("");
  }
  bind();
  renderChain();
  renderChat();
  updateNet();
  route();
  if (state.settings.defaultAgent) $("#agentSelect").value = activeAgentId();
}

try {
  init();
} catch (err) {
  console.error(err);
  toast("ASHK.AI failed to start: " + err.message, true);
}
