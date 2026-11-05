// Genera stats/bento-dark.svg y stats/bento-light.svg a partir de la API de GitHub.
// Uso: node scripts/build.mjs            (usa GH_TOKEN o `gh auth token`)
//      node scripts/build.mjs --sample   (datos de ejemplo, sin red)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'profile.json'), 'utf8'));
const SAMPLE = process.argv.includes('--sample');
const NOW = new Date();

/* ---------- datos ---------- */
const REPO_FIELDS = `name description isPrivate isFork isArchived stargazerCount forkCount pushedAt createdAt
  primaryLanguage { name color }
  languages(first: 30, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }`;

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return execSync('gh auth token', { encoding: 'utf8' }).trim();
}

async function gql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors || res.status));
  return json.data;
}

async function fetchData() {
  const head = await gql(`{ viewer { login createdAt followers { totalCount }
    contributionsCollection {
      totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions totalIssueContributions
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount weekday } } }
    } } }`);
  const v = head.viewer;
  const repos = [];
  let after = null;
  for (;;) {
    const d = await gql(`query($after: String) { viewer { repositories(ownerAffiliations: OWNER, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor } nodes { ${REPO_FIELDS} } } } }`, { after });
    const r = d.viewer.repositories;
    repos.push(...r.nodes);
    if (!r.pageInfo.hasNextPage) break;
    after = r.pageInfo.endCursor;
  }
  let events = [];
  try {
    const res = await fetch(`https://api.github.com/users/${v.login}/events/public?per_page=30`, {
      headers: { Authorization: `bearer ${token()}`, Accept: 'application/vnd.github+json' },
    });
    if (res.ok) events = await res.json();
  } catch {}
  return { login: v.login, createdAt: v.createdAt, followers: v.followers.totalCount, cc: v.contributionsCollection, repos, events };
}

function sampleData() {
  const L = { TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', Rust: '#dea584', Go: '#00ADD8' };
  const mk = (name, priv, langs, stars, days) => ({
    name, description: 'Proyecto de ejemplo ' + name, isPrivate: priv, isFork: false, isArchived: false, stargazerCount: stars, forkCount: Math.round(stars / 6),
    pushedAt: new Date(NOW - days * 864e5).toISOString(), createdAt: '2025-01-01T00:00:00Z', primaryLanguage: { name: langs[0] },
    languages: { edges: langs.map((n, i) => ({ size: 50000 / (i + 1), node: { name: n, color: L[n] } })) },
  });
  const repos = [
    mk('quillbase', false, ['Rust', 'TypeScript'], 412, 2), mk('tidewatch', false, ['Go', 'Shell'], 289, 7), mk('markwell', false, ['TypeScript', 'CSS', 'HTML'], 176, 21),
    mk('lumen-ui', false, ['TypeScript', 'CSS'], 98, 30), mk('api-kit', false, ['TypeScript', 'JavaScript', 'Python'], 60, 40), mk('dotfiles', false, ['Shell', 'Python'], 12, 9),
    mk('blog', false, ['TypeScript', 'JavaScript', 'HTML', 'CSS'], 9, 5), mk('client-a', true, ['TypeScript', 'JavaScript', 'HTML'], 0, 3), mk('client-b', true, ['JavaScript', 'Python', 'HTML'], 0, 12), mk('lab', true, ['TypeScript', 'Python', 'HTML', 'JavaScript'], 0, 1),
  ];
  const weeks = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const start = new Date(NOW - 371 * 864e5);
  for (let w = 0; w < 53; w++) { const days = []; for (let d = 0; d < 7; d++) { const dt = new Date(start.getTime() + (w * 7 + d) * 864e5); if (dt > NOW) continue;
    const b = rnd() * (d === 0 || d === 6 ? 0.5 : 1); days.push({ date: dt.toISOString().slice(0, 10), contributionCount: b < .2 ? 0 : Math.round(b * 9), weekday: dt.getUTCDay() }); } weeks.push({ contributionDays: days }); }
  const total = weeks.flatMap(w => w.contributionDays).reduce((s, d) => s + d.contributionCount, 0);
  const ev = (type, repo, extra = {}, h = 1) => ({ type, repo: { name: 'sample/' + repo }, created_at: new Date(NOW - h * 36e5).toISOString(), payload: extra });
  return { login: 'sample', createdAt: '2019-03-01T00:00:00Z', followers: 238,
    cc: { totalCommitContributions: 873, totalPullRequestContributions: 96, totalPullRequestReviewContributions: 41, totalIssueContributions: 28, contributionCalendar: { totalContributions: total, weeks } },
    repos, events: [ev('PushEvent', 'quillbase', {}, 2), ev('PullRequestEvent', 'tidewatch', { action: 'closed', pull_request: { merged: true } }, 26), ev('PullRequestReviewEvent', 'lumen-ui', {}, 50), ev('ReleaseEvent', 'tidewatch', { release: { tag_name: 'v2.1.0' } }, 74)] };
}

/* ---------- cálculo ---------- */
function compute(d) {
  const r = cfg.rules;
  const repos = d.repos.filter(x => !(r.excludeForks && x.isFork) && !(r.excludeArchived && x.isArchived) && !(r.excludeProfileRepo && x.name.toLowerCase() === d.login.toLowerCase())
    && x.languages.edges.length > 0);
  const counts = new Map();
  let bytes = 0;
  for (const repo of repos) {
    const total = repo.languages.edges.reduce((s, e) => s + e.size, 0);
    bytes += total;
    for (const e of repo.languages.edges) {
      if (e.size / total >= r.minLanguageShare) {
        const c = counts.get(e.node.name) || { name: e.node.name, color: e.node.color || '#8b949e', n: 0 };
        c.n++; counts.set(e.node.name, c);
      }
    }
  }
  const langs = [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const days = d.cc.contributionCalendar.weeks.flatMap(w => w.contributionDays);
  let cur = 0; const rev = [...days].reverse();
  let i = rev.length && rev[0].contributionCount === 0 ? 1 : 0;
  for (; i < rev.length && rev[i].contributionCount > 0; i++) cur++;
  let best = 0, run = 0;
  for (const x of days) { run = x.contributionCount > 0 ? run + 1 : 0; best = Math.max(best, run); }
  const wk = Array(7).fill(0);
  for (const x of days) wk[x.weekday] += x.contributionCount;
  const pub = repos.filter(x => !x.isPrivate);
  return { repos, N: repos.length, nPub: pub.length, nPriv: repos.length - pub.length, langs, bytes, cur, best, wk,
    stars: repos.reduce((s, x) => s + x.stargazerCount, 0), forks: repos.reduce((s, x) => s + x.forkCount, 0) };
}

/* ---------- utilidades SVG ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const ago = iso => { const m = Math.max(1, Math.round((NOW - new Date(iso)) / 6e4));
  if (m < 60) return `hace ${m} min`; const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  const dd = Math.round(h / 24); if (dd < 14) return `hace ${dd} d`; if (dd < 60) return `hace ${Math.round(dd / 7)} sem`; return `hace ${Math.round(dd / 30)} meses`; };
const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'], DAYS_FULL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

const THEMES = {
  dark: { bg: '#0d1117', tile: '#141418', line: '#23232b', fg: '#e6edf3', mid: '#9aa4b2', mut: '#6e7681', chip: '#22222b', track: '#22222b', green: '#7ee787', pillBg: '#0f2a1a', link: '#58a6ff',
    heat: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'], bar: '#3a4256', barHi: '#a78bfa', pub: '#58a6ff', priv: '#a371f7' },
  light: { bg: '#ffffff', tile: '#f6f8fa', line: '#d0d7de', fg: '#1f2328', mid: '#4b5563', mut: '#6b7280', chip: '#e7ebef', track: '#dfe4ea', green: '#1a7f37', pillBg: '#dafbe1', link: '#0969da',
    heat: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'], bar: '#b8c0cc', barHi: '#7c5cf0', pub: '#0969da', priv: '#8250df' },
};

function render(d, m, th) {
  const C = THEMES[th];
  const W = 840, P = 16, G = 10, IN = W - 2 * P;
  const A = (IN - 2 * G) / 3, B = 2 * A + G, H2 = (IN - G) / 2;
  let body = '', y = P;
  const t = (x, yy, s, o = {}) => `<text x="${x}" y="${yy}" font-family="${o.f || MONO}" font-size="${o.s || 11}" font-weight="${o.w || 400}" fill="${o.c || C.mid}"${o.a ? ` text-anchor="${o.a}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`;
  const tile = (x, yy, w, h, label, inner, fill) => {
    body += `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="14" fill="${fill || C.tile}" ${fill ? '' : `stroke="${C.line}"`}/>`;
    if (label) body += t(x + 16, yy + 24, label.toUpperCase(), { s: 10, c: fill ? 'rgba(255,255,255,.7)' : C.mut, ls: '1.2', w: 500 });
    body += inner;
  };
  const chip = (x, yy, s, bold) => { const w = Math.round(s.length * 6.4 + 20); return { w, svg: `<rect x="${x}" y="${yy}" width="${w}" height="22" rx="11" fill="${C.chip}"/>${t(x + 10, yy + 15, s, { c: bold ? C.fg : C.mid })}` }; };
  const kv = (x, yy, rows, step = 22) => rows.filter(r => r[1]).map((r, i) => t(x, yy + i * step, r[0], { c: C.mut }) + t(x + 98, yy + i * step, cut(r[1], 30), { c: C.fg })).join('');
  const topLang = m.langs[0];

  /* identidad + cuenta */
  {
    const h = 124; let inner = '';
    inner += `<circle cx="${P + 16 + 34}" cy="${y + 62}" r="34" fill="none" stroke="#6d3df0" stroke-width="3"/><circle cx="${P + 16 + 34}" cy="${y + 62}" r="28" fill="${C.line}"/>`;
    inner += t(P + 50, y + 71, (cfg.displayName || d.login)[0].toUpperCase(), { f: SANS, s: 26, w: 800, c: C.fg, a: 'middle' });
    const x0 = P + 16 + 84;
    inner += t(x0, y + 44, cut(cfg.displayName || d.login, 28), { f: SANS, s: 24, w: 800, c: C.fg });
    inner += t(x0, y + 66, cut(cfg.tagline || '', 62), { f: SANS, s: 13, c: C.mid });
    let cx = x0, cy = y + 84;
    const items = [];
    if (cfg.available?.show) items.push(['pill', cfg.available.text]);
    [cfg.location, cfg.website, cfg.languages].filter(Boolean).forEach(s => items.push(['chip', s]));
    for (const [k, s] of items) {
      if (k === 'pill') { const w = Math.round(s.length * 6.4 + 34); inner += `<rect x="${cx}" y="${cy}" width="${w}" height="22" rx="11" fill="${C.pillBg}"/><circle cx="${cx + 13}" cy="${cy + 11}" r="3.5" fill="${C.green}"/>${t(cx + 23, cy + 15, s, { c: C.green })}`; cx += w + 6; }
      else { const c = chip(cx, cy, s); if (cx + c.w < P + B - 10) { inner += c.svg; cx += c.w + 6; } }
    }
    tile(P, y, B, h, '', inner);
    const years = (NOW - new Date(d.createdAt)) / (365.25 * 864e5);
    const age = years < 1 ? `${Math.max(1, Math.round(years * 12))} ${Math.max(1, Math.round(years * 12)) === 1 ? 'mes' : 'meses'}` : `${Math.floor(years)} ${Math.floor(years) === 1 ? 'año' : 'años'}`;
    tile(P + B + G, y, A, h, 'Cuenta', kv(P + B + G + 16, y + 50, [['en GitHub', `${new Date(d.createdAt).getUTCFullYear()} · ${age}`], ['seguidores', String(d.followers)], ['estrellas', `${m.stars} ★`], ['zona', cfg.timezone]]));
    y += h + G;
  }

  /* hero + lenguajes */
  {
    const h = 196; const hx = P;
    let inner = `<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a1b6e"/><stop offset="1" stop-color="#6d3df0"/></linearGradient></defs>`;
    if (topLang) {
      const pct = Math.round((topLang.n / m.N) * 100);
      inner += t(hx + 16, y + 112, pct + '%', { f: SANS, s: 68, w: 800, c: '#fff' });
      inner += t(hx + 16, y + 144, topLang.name, { f: SANS, s: 20, w: 700, c: '#fff' });
      inner += t(hx + 16, y + 164, `en ${topLang.n} de ${m.N} ${m.N === 1 ? 'repo' : 'repos'}`, { c: 'rgba(255,255,255,.75)' });
    } else {
      inner += t(hx + 16, y + 112, '—', { f: SANS, s: 68, w: 800, c: '#fff' });
      inner += t(hx + 16, y + 144, 'Sube tu primer proyecto', { f: SANS, s: 16, w: 700, c: '#fff' });
      inner += t(hx + 16, y + 164, 'aquí aparecerá tu lenguaje principal', { c: 'rgba(255,255,255,.75)' });
    }
    tile(hx, y, A, h, 'Lenguaje más usado', inner, 'url(#hg)');
    const lx = P + A + G; let li = '';
    const rings = m.langs.slice(1, 4);
    rings.forEach((l, i) => {
      const cx = lx + 16 + 32 + i * 160, cy = y + 74, r = 26, c = 2 * Math.PI * r, p = l.n / m.N;
      li += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.track}" stroke-width="8"/>`;
      li += `<circle class="ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${l.color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}" style="--c:${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      li += t(cx, cy + 4, Math.round(p * 100) + '%', { s: 12, w: 700, c: C.fg, a: 'middle' });
      li += t(cx + 38, cy - 4, cut(l.name, 11), { c: C.fg, s: 12 }) + t(cx + 38, cy + 12, `${l.n}/${m.N} ${m.N === 1 ? 'repo' : 'repos'}`, { c: C.mut, s: 10 });
    });
    let cx = lx + 16, cy = y + 126;
    for (const l of m.langs.slice(4, 14)) {
      const c = chip(cx, cy, `${l.name} ${Math.round((l.n / m.N) * 100)}%`);
      if (cx + c.w > lx + B - 16) { cx = lx + 16; cy += 28; if (cy > y + h - 44) break; }
      li += chip(cx, cy, `${l.name} ${Math.round((l.n / m.N) * 100)}%`).svg; cx += c.w + 6;
    }
    li += t(lx + 16, y + h - 12, '% = repos donde el lenguaje pesa al menos ' + Math.round(cfg.rules.minLanguageShare * 100) + '% / total de repos', { c: C.mut, s: 10 });
    if (!m.langs.length) li += t(lx + 16, y + 80, 'Aún no hay código para analizar.', { c: C.mid, s: 13, f: SANS });
    tile(lx, y, B, h, 'Lenguajes por repos', li);
    y += h + G;
  }

  /* repos | impacto | rachas */
  {
    const h = 128; let x = P;
    let r = ''; const n = Math.min(m.N, 24); const cw = (A - 32 - (Math.max(n, 1) - 1) * 4) / Math.max(n, 1);
    const privShare = m.N ? m.nPriv / m.N : 0;
    for (let i = 0; i < n; i++) { const isPriv = i >= n - Math.round(privShare * n); r += `<rect x="${(x + 16 + i * (cw + 4)).toFixed(1)}" y="${y + 40}" width="${cw.toFixed(1)}" height="20" rx="4" fill="${isPriv ? C.priv : C.pub}"/>`; }
    if (!n) r += `<rect x="${x + 16}" y="${y + 40}" width="${A - 32}" height="20" rx="4" fill="${C.track}"/>`;
    r += t(x + 16, y + 84, `${m.N} ${m.N === 1 ? 'repo' : 'repos'}`, { c: C.fg, s: 13, w: 700 }) + t(x + 16, y + 100, `${m.nPub} públicos · ${m.nPriv} privados`, { c: C.mid });
    r += t(x + 16, y + 116, `${(m.bytes / 1e6).toFixed(m.bytes < 1e7 ? 1 : 0)} MB de código`, { c: C.mut });
    tile(x, y, A, h, 'Tus repos', r); x += A + G;
    let im = t(x + 16, y + 74, fmt(m.stars), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 16, y + 96, 'estrellas', { c: C.mut });
    im += t(x + 130, y + 74, fmt(m.forks), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 130, y + 96, 'forks', { c: C.mut });
    tile(x, y, A, h, 'Impacto', im); x += A + G;
    let rc = t(x + 16, y + 74, String(m.cur), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 16, y + 96, m.cur === 1 ? 'día seguido' : 'días seguidos', { c: C.mut });
    rc += t(x + 130, y + 74, String(m.best), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 130, y + 96, 'mejor racha', { c: C.mut });
    rc += t(x + 16, y + 116, `${d.cc.contributionCalendar.totalContributions} contribuciones en 12 meses`, { c: C.mut, s: 10 });
    tile(x, y, A, h, 'Rachas', rc);
    y += h + G;
  }

  /* heatmap */
  {
    const h = 166; const weeks = d.cc.contributionCalendar.weeks; const step = (IN - 32) / weeks.length, cs = step - 2.4;
    const max = Math.max(1, ...weeks.flatMap(w => w.contributionDays.map(x => x.contributionCount)));
    let s = ''; let lastMonth = -1, lastLbl = -9;
    weeks.forEach((w, wi) => {
      const first = w.contributionDays[0]; if (first) { const mo = new Date(first.date).getUTCMonth(); if (mo !== lastMonth) { lastMonth = mo; if (wi - lastLbl >= 3 && wi < weeks.length - 2) { lastLbl = wi; s += t(P + 16 + wi * step, y + 40, ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][mo], { c: C.mut, s: 9 }); } } }
      for (const x of w.contributionDays) { const q = x.contributionCount / max; const lv = x.contributionCount === 0 ? 0 : q > .75 ? 4 : q > .5 ? 3 : q > .25 ? 2 : 1;
        s += `<rect x="${(P + 16 + wi * step).toFixed(1)}" y="${y + 48 + x.weekday * (cs + 2.4)}" width="${cs.toFixed(1)}" height="${cs.toFixed(1)}" rx="2" fill="${C.heat[lv]}"/>`; }
    });
    tile(P, y, IN, h, 'Contribuciones, últimos 12 meses', s); y += h + G;
  }

  /* actividad | día | ahora */
  {
    const h = 172; let x = P; const cc = d.cc;
    const parts = [['Commits', cc.totalCommitContributions, '#39d353'], ['PRs', cc.totalPullRequestContributions, '#58a6ff'], ['Reviews', cc.totalPullRequestReviewContributions, '#a371f7'], ['Issues', cc.totalIssueContributions, '#e3b341']];
    const tot = parts.reduce((s, p) => s + p[1], 0) || 1; let bx = x + 16, s = '';
    parts.forEach(p => { const w = Math.max(0, (A - 32 - 6) * p[1] / tot); if (w > 0) s += `<rect x="${bx.toFixed(1)}" y="${y + 40}" width="${w.toFixed(1)}" height="10" rx="2" fill="${p[2]}"/>`; bx += w + 2; });
    parts.forEach((p, i) => { s += `<rect x="${x + 16}" y="${y + 70 + i * 24 - 8}" width="8" height="8" rx="2" fill="${p[2]}"/>` + t(x + 32, y + 70 + i * 24, p[0], { c: C.mid }) + t(x + A - 16, y + 70 + i * 24, String(p[1]), { c: C.fg, a: 'end' }); });
    tile(x, y, A, h, 'Tipo de actividad', s); x += A + G;
    const order = [1, 2, 3, 4, 5, 6, 0]; const mx = Math.max(1, ...m.wk); const top = m.wk.indexOf(Math.max(...m.wk));
    let w = ''; const bw = (A - 32 - 6 * 8) / 7;
    order.forEach((di, i) => { const bh = Math.max(3, 70 * m.wk[di] / mx); w += `<rect x="${(x + 16 + i * (bw + 8)).toFixed(1)}" y="${y + 120 - bh}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${di === top && m.wk[di] ? C.barHi : C.bar}"/>` + t(x + 16 + i * (bw + 8) + bw / 2, y + 134, DAYS[di], { s: 10, c: C.mut, a: 'middle' }); });
    w += m.wk[top] ? t(x + 16, y + 158, `Pico los ${DAYS_FULL[top]}`, { c: C.mid }) : '';
    tile(x, y, A, h, 'Día más activo', w); x += A + G;
    const n = cfg.now || {};
    tile(x, y, A, h, 'Ahora mismo', kv(x + 16, y + 54, [['construyendo', n.building], ['aprendiendo', n.learning], ['leyendo', n.reading], ['pregúntame', n.askMe]], 26) || t(x + 16, y + 56, 'Completa "now" en profile.json', { c: C.mut }));
    y += h + G;
  }

  /* destacados | actividad reciente */
  {
    const h = 186;
    let feat = m.repos.filter(r => !r.isPrivate);
    const want = cfg.featured || [];
    feat = want.length ? want.map(nm => feat.find(r => r.name === nm)).filter(Boolean) : feat.sort((a, b) => b.stargazerCount - a.stargazerCount || new Date(b.pushedAt) - new Date(a.pushedAt));
    feat = feat.slice(0, 3); let s = '';
    feat.forEach((r, i) => { const yy = y + 52 + i * 44;
      s += t(P + 16, yy, cut(r.name, 30), { c: C.link, s: 13, w: 500 }) + t(P + 16, yy + 15, cut(r.description || 'Sin descripción', 78), { f: SANS, s: 12, c: C.mid });
      const lc = r.primaryLanguage ? (r.languages.edges[0]?.node.color || '#8b949e') : null;
      s += t(P + B - 16, yy, `★ ${r.stargazerCount} · ${ago(r.pushedAt)}`, { c: C.mut, a: 'end', s: 10 });
      if (r.primaryLanguage) s += `<circle cx="${P + B - 22 - 150}" cy="${yy - 4}" r="0"/>` + t(P + B - 16, yy + 15, r.primaryLanguage.name, { c: C.mut, a: 'end', s: 10 }); });
    if (!feat.length) s += t(P + 16, y + 60, 'Aquí aparecerán tus proyectos públicos destacados.', { c: C.mid, f: SANS, s: 13 });
    tile(P, y, B, h, 'Proyectos destacados', s);
    const label = e => { const raw = e.repo.name.split('/')[1] || e.repo.name, p = e.payload || {}; const rn = raw;
      switch (e.type) { case 'PushEvent': return ['push a ', rn]; case 'PullRequestEvent': return [p.pull_request?.merged ? 'PR fusionado en ' : p.action === 'opened' ? 'PR abierto en ' : 'PR en ', rn];
        case 'PullRequestReviewEvent': return ['review en ', rn]; case 'ReleaseEvent': return ['release ', p.release?.tag_name || rn]; case 'CreateEvent': return p.ref_type === 'repository' ? ['repo creado ', rn] : null;
        case 'IssuesEvent': return ['issue en ', rn]; default: return null; } };
    const evs = (d.events || []).map(e => ({ l: label(e), at: e.created_at })).filter(e => e.l).slice(0, 5); let s2 = '';
    const fit = (pre, nm) => [pre, cut(nm, Math.max(6, 24 - pre.length))];
    evs.forEach((e, i) => { e.l = fit(e.l[0], e.l[1]); const yy = y + 52 + i * 26; s2 += `<circle cx="${P + B + G + 22}" cy="${yy - 4}" r="3" fill="${C.green}"/>` + t(P + B + G + 34, yy, e.l[0], { c: C.mid }) + t(P + B + G + 34 + e.l[0].length * 6.6, yy, e.l[1], { c: C.fg }) + t(P + B + G + A - 16, yy, ago(e.at), { c: C.mut, a: 'end', s: 10 }); });
    if (!evs.length) s2 += t(P + B + G + 16, y + 56, 'Sin actividad pública reciente.', { c: C.mid });
    tile(P + B + G, y, A, h, 'Actividad reciente', s2);
    y += h + G;
  }

  /* stack */
  {
    const h = 68; const stack = cfg.stack?.length ? cfg.stack : m.langs.slice(0, 10).map(l => l.name);
    let x = P + 16, s = '';
    for (const it of stack) { const c = chip(x, y + 34, it, true); if (x + c.w > P + IN - 16) break; s += c.svg; x += c.w + 6; }
    tile(P, y, IN, h, cfg.stack?.length ? 'Stack y herramientas' : 'Stack (según tus repos)', s); y += h + G;
  }

  body += t(P, y + 12, `Actualizado automáticamente · ${NOW.toISOString().slice(0, 10)} UTC`, { c: C.mut, s: 10 });
  body += t(P + IN, y + 12, 'Los repos privados solo suman a los números, nunca se muestran por nombre', { c: C.mut, s: 10, a: 'end' });
  const H = y + 12 + P;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estadísticas de GitHub de ${esc(d.login)}">
<style>.ring{animation:draw 1.2s ease-out both}@keyframes draw{from{stroke-dashoffset:var(--c)}}@media (prefers-reduced-motion:reduce){.ring{animation:none}}</style>
<rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>${body}</svg>`;
}

/* ---------- main ---------- */
const data = SAMPLE ? sampleData() : await fetchData();
const m = compute(data);
mkdirSync(join(ROOT, 'stats'), { recursive: true });
for (const th of ['dark', 'light']) writeFileSync(join(ROOT, 'stats', `bento-${th}.svg`), render(data, m, th));
console.log(`OK ${data.login}: ${m.N} repos (${m.nPub} públicos, ${m.nPriv} privados), top: ${m.langs.slice(0, 3).map(l => `${l.name} ${l.n}/${m.N}`).join(', ') || '-'}`);
