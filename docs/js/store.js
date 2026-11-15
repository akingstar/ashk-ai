import { DEFAULT_SETTINGS } from "./config.js";

const K = {
  settings: "ashk.settings.v5",
  chats: "ashk.chats.v5",
  active: "ashk.activeChat.v5",
  about: "ashk.about.v5",
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function uid(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

export const store = {
  settings() {
    const saved = read(K.settings, {});
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      keys: { ...DEFAULT_SETTINGS.keys, ...(saved.keys || {}) },
      custom: { ...DEFAULT_SETTINGS.custom, ...(saved.custom || {}) },
      worker: { ...DEFAULT_SETTINGS.worker, ...(saved.worker || {}) },
    };
  },

  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    write(K.settings, next);
    return next;
  },

  chats() {
    const list = read(K.chats, []);
    return Array.isArray(list) ? list : [];
  },

  saveChats(list) {
    const capped = list.slice(0, 40).map((c) => ({
      ...c,
      messages: Array.isArray(c.messages) ? c.messages.slice(-120) : [],
    }));
    write(K.chats, capped);
  },

  getChat(id) {
    return this.chats().find((c) => c.id === id) || null;
  },

  upsertChat(chat) {
    const list = this.chats();
    const i = list.findIndex((c) => c.id === chat.id);
    chat.updatedAt = Date.now();
    if (i >= 0) list[i] = chat;
    else list.unshift(chat);
    this.saveChats(list);
    return chat;
  },

  removeChat(id) {
    this.saveChats(this.chats().filter((c) => c.id !== id));
  },

  activeId() {
    return read(K.active, null);
  },

  setActiveId(id) {
    write(K.active, id);
  },

  about() {
    return read(K.about, "");
  },

  setAbout(text) {
    write(K.about, String(text || "").slice(0, 1500));
  },

  clearAll() {
    Object.values(K).forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    });
  },
};

export function newChat(agent = "auto") {
  return {
    id: uid("chat"),
    title: "New session",
    agent,
    messages: [],
    route: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function titleFromText(text) {
  const clean = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "New session";
  return clean.length > 52 ? clean.slice(0, 52).trimEnd() + "…" : clean;
}
