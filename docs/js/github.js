import { GITHUB_API } from "./config.js";

const API_VERSION = "2022-11-28";

export function parseRepo(input) {
  let raw = String(input || "").trim();
  if (!raw) throw new Error("Enter a repository, for example owner/repo");
  raw = raw.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  raw = raw.split(/[?#]/)[0];
  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Use the form owner/repo or a full GitHub URL");
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("That does not look like a valid GitHub repository");
  }
  return { owner, repo, full: owner + "/" + repo, url: `https://github.com/${owner}/${repo}` };
}

function headers(token, accept) {
  const h = {
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(path, { token, accept, text = false } = {}) {
  const res = await fetch(GITHUB_API + path, { headers: headers(token, accept) });
  const rate = {
    remaining: Number(res.headers.get("x-ratelimit-remaining") || NaN),
    limit: Number(res.headers.get("x-ratelimit-limit") || NaN),
    reset: Number(res.headers.get("x-ratelimit-reset") || NaN),
  };
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.message || "";
    } catch {
      /* ignore */
    }
    const err = new Error(detail || `GitHub API ${res.status}`);
    err.status = res.status;
    err.rate = rate;
    throw err;
  }
  const data = text ? await res.text() : await res.json();
  return { data, rate };
}

function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000);
}

export function formatNumber(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
}

export function timeAgo(iso) {
  if (!iso) return "unknown";
  const d = daysSince(iso);
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return Math.round(d) + " days ago";
  if (d < 365) return Math.round(d / 30) + " months ago";
  return (d / 365).toFixed(1) + " years ago";
}

function pctMap(languages) {
  const entries = Object.entries(languages || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return entries.slice(0, 6).map(([name, bytes]) => ({
    name,
    pct: Math.round((bytes / total) * 1000) / 10,
  }));
}

export function scoreBundle(bundle) {
  const { repo, readme, languages, tree, release, contributors } = bundle;
  const readmeLen = (readme || "").length;
  const names = (tree || []).map((f) => f.name.toLowerCase());
  const hasLicense = Boolean(repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION");
  const hasSecurity = names.some((n) => n === "security.md" || n === ".github" || n === "dependabot.yml" || n === "renovate.json");
  const hasTests = names.some((n) => /^(test|tests|__tests__|spec)$/.test(n));
  const hasCi = names.includes(".github") || names.some((n) => n.includes("workflow"));
  const pushed = daysSince(repo.pushed_at);
  const created = daysSince(repo.created_at);
  const issueRatio = repo.open_issues_count / Math.max(1, repo.stargazers_count + repo.forks_count);

  let docs = 3;
  if (readmeLen > 400) docs = 5;
  if (readmeLen > 1200) docs = 6.5;
  if (readmeLen > 3000) docs = 7.5;
  if (readmeLen > 6000) docs = 8.5;
  if (hasLicense) docs += 0.7;
  if (repo.description) docs += 0.4;
  if ((repo.topics || []).length >= 3) docs += 0.4;
  if (/install|quick ?start|usage|getting started/i.test(readme || "")) docs += 0.4;

  let activity = 2;
  if (pushed < 7) activity = 9.6;
  else if (pushed < 30) activity = 8.8;
  else if (pushed < 90) activity = 7.4;
  else if (pushed < 180) activity = 6;
  else if (pushed < 365) activity = 4.4;
  if (release) activity += 0.3;
  if ((contributors || []).length >= 3) activity += 0.3;

  const pop = Math.log10(1 + Number(repo.stargazers_count || 0)) * 2.6 + Math.log10(1 + Number(repo.forks_count || 0)) * 2.2;
  let popularity = Math.min(10, 2 + pop);

  let maintenance = 5;
  if (repo.archived) maintenance = 1.5;
  else {
    if (pushed < 120) maintenance += 1.4;
    if (hasLicense) maintenance += 0.8;
    if (release) maintenance += 0.8;
    if (repo.open_issues_count < 30) maintenance += 0.6;
    if (issueRatio > 0.5) maintenance -= 2.2;
    if (created < 60 && repo.stargazers_count < 20) maintenance -= 1.2;
  }

  let security = 4.5;
  if (hasLicense) security += 1.2;
  if (hasSecurity) security += 1.2;
  if (hasTests) security += 0.7;
  if (hasCi) security += 0.7;
  if (repo.archived) security -= 2;
  if ((repo.open_issues_count || 0) > 300) security -= 0.7;

  let usability = 4.5;
  if (repo.homepage) usability += 0.9;
  if (repo.description) usability += 0.8;
  if (readmeLen > 1000) usability += 1;
  if ((repo.topics || []).length) usability += 0.6;
  if ((languages && Object.keys(languages).length) > 0) usability += 0.4;
  if (repo.archived) usability -= 2;

  const clamp = (n) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
  const dims = {
    substance: clamp((popularity + usability) / 2),
    architecture: clamp((docs + security) / 2),
    documentation: clamp(docs),
    activity: clamp(activity),
    security: clamp(security),
    usability: clamp(usability),
    maintenance: clamp(maintenance),
    popularity: clamp(popularity),
  };

  const overall = Math.round(
    (dims.documentation * 0.18 +
      dims.activity * 0.18 +
      dims.security * 0.15 +
      dims.maintenance * 0.16 +
      dims.usability * 0.14 +
      dims.popularity * 0.09 +
      dims.substance * 0.1) *
      10
  );

  return { overall, dims, signals: { hasLicense, hasSecurity, hasTests, hasCi, readmeLen, pushedDays: Math.round(pushed) } };
}

export async function fetchRepoBundle(input, token = "") {
  const parsed = parseRepo(input);

  let repoRes;
  try {
    repoRes = await gh(`/repos/${parsed.owner}/${parsed.repo}`, { token });
  } catch (err) {
    if (err.status === 404) throw new Error(`Repository “${parsed.full}” was not found, or it is private.`);
    if (err.status === 403 || err.status === 429) {
      const reset = err.rate?.reset ? new Date(err.rate.reset * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
      throw new Error(
        `GitHub API rate limit reached${reset ? " (resets around " + reset + ")" : ""}. Add a read-only GitHub token in settings for 5,000 requests/hour.`
      );
    }
    throw err;
  }

  const repo = repoRes.data;
  const [langRes, readmeRes, treeRes, releaseRes, contribRes] = await Promise.allSettled([
    gh(`/repos/${parsed.owner}/${parsed.repo}/languages`, { token }),
    gh(`/repos/${parsed.owner}/${parsed.repo}/readme`, {
      token,
      accept: "application/vnd.github.raw+json",
      text: true,
    }),
    gh(`/repos/${parsed.owner}/${parsed.repo}/contents/`, { token }),
    gh(`/repos/${parsed.owner}/${parsed.repo}/releases/latest`, { token }),
    gh(`/repos/${parsed.owner}/${parsed.repo}/contributors?per_page=6`, { token }),
  ]);

  const languages = langRes.status === "fulfilled" ? langRes.value.data : {};
  let readme = readmeRes.status === "fulfilled" ? readmeRes.value.data : "";
  if (typeof readme !== "string") readme = "";
  if (readme.length > 9000) readme = readme.slice(0, 9000) + "\n\n[README truncated]";
  const tree = treeRes.status === "fulfilled" && Array.isArray(treeRes.value.data)
    ? treeRes.value.data.slice(0, 60).map((item) => ({
        name: item.name,
        type: item.type,
        size: item.size,
      }))
    : [];
  const release = releaseRes.status === "fulfilled" ? releaseRes.value.data : null;
  const contributors = contribRes.status === "fulfilled" ? contribRes.value.data : [];

  const bundle = {
    parsed,
    repo,
    languages,
    langPct: pctMap(languages),
    readme,
    tree,
    release,
    contributors: (contributors || []).slice(0, 6).map((c) => ({ login: c.login, contributions: c.contributions })),
    rate: repoRes.rate,
    fetchedAt: new Date().toISOString(),
  };
  bundle.scores = scoreBundle(bundle);
  return bundle;
}

export function buildAnalysisPrompt(bundle) {
  const { repo, langPct, readme, tree, release, contributors, scores, parsed } = bundle;
  const treeLines = tree.map((t) => `${t.type === "dir" ? "[dir] " : ""}${t.name}`).join(", ");
  const data = {
    repository: parsed.full,
    description: repo.description || "none",
    url: repo.html_url,
    homepage: repo.homepage || "none",
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    open_issues: repo.open_issues_count,
    license: repo.license?.spdx_id || "none",
    archived: repo.archived,
    default_branch: repo.default_branch,
    created: repo.created_at,
    last_push: repo.pushed_at,
    size_kb: repo.size,
    topics: repo.topics || [],
    languages: langPct,
    latest_release: release ? { tag: release.tag_name, published: release.published_at, name: release.name } : "none",
    contributors: contributors.map((c) => `${c.login} (${c.contributions})`),
    top_level_files: treeLines || "unavailable",
    local_scorecard: scores,
    readme_excerpt: readme || "README unavailable",
  };

  return `Analyze this public GitHub repository using ONLY the data below. Do not invent files, metrics, vulnerabilities or history.

DATA:
${JSON.stringify(data, null, 2)}

Write the report in markdown with exactly these sections:

## Verdict
A 2–3 sentence plain-language judgement. Then a line: **Score: N/100 — <label>** using the local scorecard as a starting point, adjusted only if the evidence justifies it.

## What it is
Explain the project to a smart developer who has never seen it. Include who it is for.

## Scorecard
A table with columns: Dimension | Score /10 | Evidence. Use substance, architecture, documentation, activity, security, usability, maintenance, popularity. Evidence must reference the data above.

## Architecture & key files
What the structure suggests about how the project is built. Name the files or directories a new contributor should read first. Mark inference as "inferred".

## Strengths
3–6 bullets, each tied to evidence.

## Red flags & unknowns
3–6 bullets. Separate "observed" facts from "inferred" concerns. If data is missing, say so instead of guessing.

## Who should use it
Two short lists: "Good fit" and "Avoid if".

## 30-day plan
3–5 prioritized actions a maintainer could take to improve the project, each with expected impact.

## Read these first
A short ordered list of files/directories, with one line on why.

End with: "Confidence: high|medium|low — <one line reason>. Based on public metadata as of ${new Date().toISOString().slice(0, 10)}; this is not a formal security audit."`;
}

export const ANALYSIS_SYSTEM = `You are a senior software engineer and open-source maintainer performing a careful repository review. You are skeptical, concrete and evidence-led. You never fabricate data, CVEs, files or metrics. You clearly separate what the data shows from what you infer. You write tight markdown with tables and short paragraphs, with no filler.`;
