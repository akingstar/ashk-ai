const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

function safeUrl(raw) {
  const url = String(raw || "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^(\/|#)/.test(url)) return url;
  return null;
}

function inline(text) {
  const codes = [];
  let s = escapeHtml(text);

  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = codes.length;
    codes.push(code);
    return `\u0000IC${i}\u0000`;
  });

  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const url = safeUrl(href.replace(/&amp;/g, "&"));
    if (!url) return label;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  s = s.replace(/\u0000IC(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return s;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function renderMarkdown(source) {
  if (!source) return "";
  let src = String(source).replace(/\r\n?/g, "\n");

  const codeBlocks = [];
  src = src.replace(/```([\w+#.-]*)[ \t]*\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push({ lang: lang || "", code: code.replace(/\n$/, "") });
    return `\n\u0000CB${i}\u0000\n`;
  });

  const lines = src.split("\n");
  const out = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    out.push(`<${listType}>${listItems.map((li) => `<li>${inline(li)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const codeMatch = trimmed.match(/^\u0000CB(\d+)\u0000$/);
    if (codeMatch) {
      flushAll();
      const block = codeBlocks[Number(codeMatch[1])];
      if (block) {
        const lang = block.lang ? `<span class="code-lang">${escapeHtml(block.lang)}</span>` : "";
        out.push(`${lang}<pre><code>${escapeHtml(block.code)}</code></pre>`);
      }
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    if (listType && /^[-*+]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*+]\s+/, ""));
      continue;
    }
    if (listType && /^\d+[.)]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^\d+[.)]\s+/, ""));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length, 4);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    const q = trimmed.match(/^>\s?(.*)$/);
    if (q) {
      flushParagraph();
      flushList();
      quote.push(q[1]);
      continue;
    }

    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]) &&
      !isTableSeparator(trimmed)
    ) {
      flushAll();
      const headers = splitRow(trimmed);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      const head = `<thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>`;
      const body = `<tbody>${rows
        .map((r) => `<tr>${headers.map((_, idx) => `<td>${inline(r[idx] || "")}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      out.push(`<table>${head}${body}</table>`);
      continue;
    }

    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ul[1]);
      continue;
    }

    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ol[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return out.join("\n");
}

export function stripMarkdown(source) {
  return String(source || "")
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
