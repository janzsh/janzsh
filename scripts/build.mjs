// Genera stats/bento-{dark,light}.svg (escritorio) y stats/bento-mobile-{dark,light}.svg a partir de la API de GitHub.
// Uso: node scripts/build.mjs                 (usa GH_TOKEN o `gh auth token`)
//      node scripts/build.mjs --sample        (datos de ejemplo, sin red)
//      node scripts/build.mjs --out <carpeta> (escribe los SVG ahí en vez de stats/)
// Si cualquier consulta falla tras los reintentos, termina con error y no escribe nada.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'profile.json'), 'utf8'));
const SAMPLE = process.argv.includes('--sample');
const outArg = process.argv.indexOf('--out');
if (outArg !== -1 && !process.argv[outArg + 1]) { console.error('--out necesita una carpeta, p. ej. --out /tmp/preview'); process.exit(1); }
const OUT = outArg === -1 ? join(ROOT, 'stats') : resolve(process.argv[outArg + 1]);
const NOW = new Date();

/* ---------- datos ---------- */
const REPO_FIELDS = `name description isPrivate isFork isArchived stargazerCount forkCount pushedAt createdAt
  primaryLanguage { name color }
  languages(first: 30, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }`;

let cachedToken;
function token() {
  if (cachedToken) return cachedToken;
  if (process.env.GH_TOKEN) return (cachedToken = process.env.GH_TOKEN);
  try { cachedToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  if (!cachedToken) throw new Error('Falta el token: define GH_TOKEN (en Actions, el secreto GH_STATS_TOKEN) o inicia sesión con `gh auth login`.');
  return cachedToken;
}

// fetch con tiempo límite y hasta 3 intentos ante fallos transitorios (red, 5xx, 429).
const TRIES = 3, TIMEOUT = 15000;
async function request(label, url, init = {}) {
  for (let i = 1; ; i++) {
    let res, err;
    try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) }); } catch (e) { err = e.message; }
    const transient = err || res.status >= 500 || res.status === 429;
    if (transient && i < TRIES) { console.warn(`${label}: intento ${i} falló (${err || 'HTTP ' + res.status}), reintentando…`); await new Promise(r => setTimeout(r, 2000 * i)); continue; }
    if (err) throw new Error(`${label}: sin respuesta tras ${TRIES} intentos (${err})`);
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
}

async function gql(query, variables = {}) {
  const json = await request('GraphQL', 'https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors));
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
  const events = await request('Eventos', `https://api.github.com/users/${v.login}/events/public?per_page=50`, {
    headers: { Authorization: `bearer ${token()}`, Accept: 'application/vnd.github+json' },
  });
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
  // Como en GitHub: semanas de domingo a sábado, la última termina hoy.
  const weeks = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const start = new Date(NOW - (52 * 7 + NOW.getUTCDay()) * 864e5);
  for (let w = 0; w < 53; w++) { const days = []; for (let d = 0; d < 7; d++) { const dt = new Date(start.getTime() + (w * 7 + d) * 864e5); if (dt > NOW) continue;
    const b = rnd() * (d === 0 || d === 6 ? 0.5 : 1); days.push({ date: dt.toISOString().slice(0, 10), contributionCount: b < .2 ? 0 : Math.round(b * 9), weekday: dt.getUTCDay() }); } weeks.push({ contributionDays: days }); }
  const total = weeks.flatMap(w => w.contributionDays).reduce((s, d) => s + d.contributionCount, 0);
  const ev = (type, repo, extra = {}, h = 1) => ({ type, repo: { name: 'sample/' + repo }, created_at: new Date(NOW - h * 36e5).toISOString(), payload: extra });
  return { login: 'sample', createdAt: '2019-03-01T00:00:00Z', followers: 238,
    cc: { totalCommitContributions: 873, totalPullRequestContributions: 96, totalPullRequestReviewContributions: 41, totalIssueContributions: 28, contributionCalendar: { totalContributions: total, weeks } },
    repos, events: [ev('PullRequestEvent', 'tidewatch', { action: 'merged' }, 26), ev('PushEvent', 'quillbase', {}, 2), ev('PushEvent', 'quillbase', {}, 5), ev('PullRequestEvent', 'markwell', { action: 'closed' }, 30),
      ev('PullRequestReviewEvent', 'lumen-ui', {}, 50), ev('ReleaseEvent', 'tidewatch', { release: { tag_name: 'v2.1.0' } }, 74)] };
}

/* ---------- cálculo ---------- */
function compute(d) {
  const r = cfg.rules;
  const repos = d.repos.filter(x => !(r.excludeForks && x.isFork) && !(r.excludeArchived && x.isArchived) && !(r.excludeProfileRepo && x.name.toLowerCase() === d.login.toLowerCase()));
  // Los repos sin código detectado cuentan en los totales, pero no en los porcentajes de lenguajes.
  const coded = repos.filter(x => x.languages.edges.length > 0);
  const counts = new Map();
  let bytes = 0;
  for (const repo of coded) {
    const total = repo.languages.edges.reduce((s, e) => s + e.size, 0);
    bytes += total;
    for (const e of repo.languages.edges) {
      if (e.size / total >= r.minLanguageShare) {
        const c = counts.get(e.node.name) || { name: e.node.name, color: e.node.color || '#8b949e', n: 0, bytes: 0 };
        c.n++; c.bytes += e.size; counts.set(e.node.name, c);
      }
    }
  }
  const langs = [...counts.values()].sort((a, b) => b.n - a.n || b.bytes - a.bytes || a.name.localeCompare(b.name));
  const days = d.cc.contributionCalendar.weeks.flatMap(w => w.contributionDays);
  let cur = 0; const rev = [...days].reverse();
  let i = rev.length && rev[0].contributionCount === 0 ? 1 : 0;
  for (; i < rev.length && rev[i].contributionCount > 0; i++) cur++;
  let best = 0, run = 0;
  for (const x of days) { run = x.contributionCount > 0 ? run + 1 : 0; best = Math.max(best, run); }
  const wk = Array(7).fill(0);
  for (const x of days) wk[x.weekday] += x.contributionCount;
  const pub = repos.filter(x => !x.isPrivate);
  return { repos, N: repos.length, NL: coded.length, nPub: pub.length, nPriv: repos.length - pub.length, langs, bytes, cur, best, wk,
    stars: repos.reduce((s, x) => s + x.stargazerCount, 0), forks: repos.reduce((s, x) => s + x.forkCount, 0) };
}

/* ---------- utilidades SVG ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
// Ancho estimado del texto: las monoespaciadas miden ~0.6em por carácter; para sans se usa un promedio.
const tw = (s, size = 11, f = MONO) => String(s).length * size * (f === MONO ? 0.6 : 0.52);
const clip = (s, maxW, size = 11, f = MONO) => {
  s = String(s); if (tw(s, size, f) <= maxW) return s;
  return s.slice(0, Math.max(1, Math.floor(maxW / tw('x', size, f)) - 1)).trimEnd() + '…';
};
const wrap = (s, maxW, maxLines, size = 11, f = MONO) => {
  const lines = []; let cur = '';
  for (const w of String(s).split(/\s+/)) { const nx = cur ? `${cur} ${w}` : w; if (!cur || tw(nx, size, f) <= maxW) cur = nx; else { lines.push(cur); cur = w; } }
  lines.push(cur);
  if (lines.length > maxLines) lines.splice(maxLines - 1, Infinity, lines.slice(maxLines - 1).join(' '));
  return lines.map(l => clip(l, maxW, size, f));
};
/* contraste WCAG; los colores de lenguaje se ajustan hasta 3:1 contra el fondo del tile */
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const legible = (hex, bg, toward, min = 3) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  let c = hex; for (let k = 0.05; ratio(c, bg) < min && k <= 1; k += 0.05) c = mix(hex, toward, k);
  return c;
};
// Redondea hacia abajo, como GitHub: 36 h es "hace 1 d", no "hace 2 d".
const ago = iso => { const m = Math.max(1, Math.floor((NOW - new Date(iso)) / 6e4));
  if (m < 60) return `hace ${m} min`; const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
  const dd = Math.floor(h / 24); if (dd < 14) return `hace ${dd} d`; if (dd < 60) return `hace ${Math.floor(dd / 7)} sem`;
  const mo = Math.floor(dd / 30); return `hace ${mo} ${mo === 1 ? 'mes' : 'meses'}`; };
const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'], DAYS_FULL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

const THEMES = {
  dark: { bg: '#0d1117', tile: '#141418', line: '#23232b', fg: '#e6edf3', mid: '#9aa4b2', mut: '#7d8590', chip: '#22222b', track: '#22222b', green: '#7ee787', pillBg: '#0f2a1a', link: '#58a6ff',
    heat: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'], bar: '#3a4256', barHi: '#a78bfa', pub: '#58a6ff', priv: '#a371f7' },
  light: { bg: '#ffffff', tile: '#f6f8fa', line: '#d0d7de', fg: '#1f2328', mid: '#4b5563', mut: '#6b7280', chip: '#e7ebef', track: '#dfe4ea', green: '#1a7f37', pillBg: '#dafbe1', link: '#0969da',
    heat: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'], bar: '#b8c0cc', barHi: '#7c5cf0', pub: '#0969da', priv: '#8250df' },
};

// Primero los de `featured` (en ese orden) y el resto de huecos por estrellas y actividad.
function pickFeatured(m) {
  const pub = m.repos.filter(r => !r.isPrivate);
  const pinned = (cfg.featured || []).map(nm => pub.find(r => r.name.toLowerCase() === nm.toLowerCase())).filter(Boolean);
  const rest = pub.filter(r => !pinned.includes(r)).sort((a, b) => b.stargazerCount - a.stargazerCount || new Date(b.pushedAt) - new Date(a.pushedAt));
  return [...pinned, ...rest].slice(0, 3);
}

// Resumen en texto de la imagen: va en el alt del README (lo que leen los lectores de pantalla,
// porque GitHub muestra el SVG como <img>) y en el aria-label del propio SVG.
function summary(d, m) {
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`, top = m.langs[0], feat = pickFeatured(m);
  return [
    `Estadísticas de GitHub de ${cfg.displayName || d.login}: ${pl(m.N, 'repo', 'repos')} (${m.nPub} públicos, ${m.nPriv} privados)`,
    top ? `lenguaje principal ${top.name} (en ${top.n} de ${m.NL} repos)` : null,
    `${pl(d.cc.contributionCalendar.totalContributions, 'contribución', 'contribuciones')} en los últimos 12 meses`,
    `racha actual de ${pl(m.cur, 'día', 'días')} y mejor racha de ${pl(m.best, 'día', 'días')}`,
    pl(m.stars, 'estrella', 'estrellas'),
  ].filter(Boolean).join(', ') + '.' + (feat.length ? ` Proyectos destacados: ${feat.map(r => r.name).join(', ')}.` : '');
}

const warned = new Set();
const warnOnce = msg => { if (!warned.has(msg)) { warned.add(msg); console.warn(msg); } };

// Escritorio: cuadrícula de 3 columnas a 840 px. Móvil: una columna a 420 px, para que el texto
// no quede diminuto al escalar la imagen al ancho de un teléfono.
function render(d, m, th, mobile = false) {
  const C = THEMES[th];
  const W = mobile ? 420 : 840, P = 16, G = 10, IN = W - 2 * P;
  const A = (IN - 2 * G) / 3, B = 2 * A + G;
  const toward = th === 'dark' ? '#ffffff' : '#000000';
  let body = '';
  const t = (x, yy, s, o = {}) => `<text x="${x}" y="${yy}" font-family="${o.f || MONO}" font-size="${o.s || 11}" font-weight="${o.w || 400}" fill="${o.c || C.mid}"${o.a ? ` text-anchor="${o.a}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`;
  const tile = (x, yy, w, h, label, inner, fill) => {
    body += `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="14" fill="${fill || C.tile}" ${fill ? '' : `stroke="${C.line}"`}/>`;
    if (label) body += t(x + 16, yy + 24, label.toUpperCase(), { s: 10, c: fill ? 'rgba(255,255,255,.7)' : C.mut, ls: '1.2', w: 500 });
    body += inner;
  };
  const chip = (x, yy, s, bold) => { const w = Math.round(tw(s) + 20); return { w, svg: `<rect x="${x}" y="${yy}" width="${w}" height="22" rx="11" fill="${C.chip}"/>${t(x + 10, yy + 15, s, { c: bold ? C.fg : C.mid })}` }; };
  // Filas etiqueta/valor dentro de un tile de ancho w; con `lines` > 1 el valor se parte en varias líneas.
  const kv = (x, yy, rows, w, { step = 22, lines = 1, maxY = Infinity } = {}) => {
    const vw = w - 32 - 98; let out = '', cy = yy;
    for (const [k, v] of rows.filter(r => r[1])) {
      if (cy > maxY) break;
      let ls = wrap(v, vw, lines); if (cy + (ls.length - 1) * 14 > maxY) ls = [clip(v, vw)];
      out += t(x, cy, k, { c: C.mut }) + ls.map((l, i) => t(x + 98, cy + i * 14, l, { c: C.fg })).join('');
      cy += step + (ls.length - 1) * 14;
    }
    return out;
  };
  // Reparte chips en filas dentro de [x0, xMax]; devuelve posiciones relativas y cuántas filas usó.
  const flow = (items, x0, xMax, maxRows, where) => {
    let cx = x0, row = 0; const placed = [];
    for (const it of items) {
      const s = clip(it.s, xMax - x0 - it.pad), w = Math.round(tw(s) + it.pad);
      if (cx > x0 && cx + w > xMax) { row++; cx = x0; }
      if (row >= maxRows) { warnOnce(`Aviso: "${it.s}" no cabe en ${where}`); break; }
      placed.push({ ...it, s, w, x: cx, row }); cx += w + 6;
    }
    return { placed, rows: placed.length ? placed[placed.length - 1].row + 1 : 1 };
  };
  const topLang = m.langs[0];

  // Cada sección recibe su ancho y devuelve su altura natural y cómo dibujarse; el layout decide dónde.
  const S = {};

  S.identity = w => {
    const narrow = w < 500, x0 = 100, xMax = w - 16;
    const tag = narrow ? wrap(cfg.tagline || '', xMax - x0, 2, 13, SANS) : [clip(cfg.tagline || '', xMax - x0, 13, SANS)];
    // En móvil los chips van debajo del avatar, a todo el ancho.
    const cx0 = narrow ? 16 : x0, cy0 = narrow ? 112 : 84;
    const items = [];
    if (cfg.available?.show) items.push({ k: 'pill', s: cfg.available.text, pad: 34 });
    [cfg.location, cfg.website, cfg.languages].filter(Boolean).forEach(s => items.push({ k: 'chip', s, pad: 20 }));
    const { placed, rows } = flow(items, cx0, xMax, narrow ? 3 : 2, 'la cabecera');
    return { h: cy0 + 40 + (rows - 1) * 28, draw(x, y, h) {
      let inner = `<circle cx="${x + 50}" cy="${y + 62}" r="34" fill="none" stroke="#6d3df0" stroke-width="3"/><circle cx="${x + 50}" cy="${y + 62}" r="28" fill="${C.line}"/>`;
      inner += t(x + 50, y + 71, (cfg.displayName || d.login)[0].toUpperCase(), { f: SANS, s: 26, w: 800, c: C.fg, a: 'middle' });
      inner += t(x + x0, y + 44, clip(cfg.displayName || d.login, xMax - x0, 24, SANS), { f: SANS, s: 24, w: 800, c: C.fg });
      tag.forEach((l, i) => { inner += t(x + x0, y + 66 + i * 16, l, { f: SANS, s: 13, c: C.mid }); });
      for (const p of placed) {
        const px = x + p.x, py = y + cy0 + p.row * 28;
        if (p.k === 'pill') inner += `<rect x="${px}" y="${py}" width="${p.w}" height="22" rx="11" fill="${C.pillBg}"/><circle cx="${px + 13}" cy="${py + 11}" r="3.5" fill="${C.green}"/>${t(px + 23, py + 15, p.s, { c: C.green })}`;
        else inner += chip(px, py, p.s).svg;
      }
      tile(x, y, w, h, '', inner);
    } };
  };

  S.account = w => ({ h: 124, draw(x, y, h) {
    const years = (NOW - new Date(d.createdAt)) / (365.25 * 864e5);
    const age = years < 1 ? `${Math.max(1, Math.round(years * 12))} ${Math.max(1, Math.round(years * 12)) === 1 ? 'mes' : 'meses'}` : `${Math.floor(years)} ${Math.floor(years) === 1 ? 'año' : 'años'}`;
    tile(x, y, w, h, 'Cuenta', kv(x + 16, y + 50, [['en GitHub', `${new Date(d.createdAt).getUTCFullYear()} · ${age}`], ['seguidores', String(d.followers)], ['estrellas', `${m.stars} ★`], ['zona', cfg.timezone]], w));
  } });

  S.hero = w => ({ h: 196, draw(x, y, h) {
    let inner = `<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a1b6e"/><stop offset="1" stop-color="#6d3df0"/></linearGradient></defs>`;
    if (topLang) {
      const pct = Math.round((topLang.n / m.NL) * 100);
      inner += t(x + 16, y + 112, pct + '%', { f: SANS, s: 68, w: 800, c: '#fff' });
      inner += t(x + 16, y + 144, clip(topLang.name, w - 32, 20, SANS), { f: SANS, s: 20, w: 700, c: '#fff' });
      inner += t(x + 16, y + 164, `en ${topLang.n} de ${m.NL} ${m.NL === 1 ? 'repo' : 'repos'}`, { c: 'rgba(255,255,255,.75)' });
    } else {
      inner += t(x + 16, y + 112, '—', { f: SANS, s: 68, w: 800, c: '#fff' });
      inner += t(x + 16, y + 144, 'Sube tu primer proyecto', { f: SANS, s: 16, w: 700, c: '#fff' });
      inner += t(x + 16, y + 164, 'aquí aparecerá tu lenguaje principal', { c: 'rgba(255,255,255,.75)' });
    }
    tile(x, y, w, h, 'Lenguaje más usado', inner, 'url(#hg)');
  } });

  S.langs = w => { const narrow = w < 500; return { h: narrow ? 218 : 196, draw(x, y, h) {
    let li = ''; const colW = (w - 32) / 3, share = Math.round(cfg.rules.minLanguageShare * 100);
    m.langs.slice(1, 4).forEach((l, i) => {
      // En móvil no cabe el nombre al lado del anillo: va debajo, centrado.
      const cx = narrow ? +(x + 16 + colW * (i + 0.5)).toFixed(1) : x + 16 + 32 + i * 160, cy = y + 74, r = 26, c = 2 * Math.PI * r, p = l.n / m.NL;
      li += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.track}" stroke-width="8"/>`;
      li += `<circle class="ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${legible(l.color, C.tile, toward)}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}" style="--c:${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      li += t(cx, cy + 4, Math.round(p * 100) + '%', { s: 12, w: 700, c: C.fg, a: 'middle' });
      const sub = `${l.n}/${m.NL} ${m.NL === 1 ? 'repo' : 'repos'}`;
      li += narrow ? t(cx, cy + 50, clip(l.name, colW - 8, 12), { c: C.fg, s: 12, a: 'middle' }) + t(cx, cy + 64, sub, { c: C.mut, s: 10, a: 'middle' })
        : t(cx + 38, cy - 4, cut(l.name, 11), { c: C.fg, s: 12 }) + t(cx + 38, cy + 12, sub, { c: C.mut, s: 10 });
    });
    let cx = x + 16, cy = y + (narrow ? 150 : 126);
    for (const l of m.langs.slice(4, 14)) {
      const c = chip(cx, cy, `${l.name} ${Math.round((l.n / m.NL) * 100)}%`);
      if (cx + c.w > x + w - 16) { cx = x + 16; cy += 28; if (cy > y + h - 44) break; }
      li += chip(cx, cy, `${l.name} ${Math.round((l.n / m.NL) * 100)}%`).svg; cx += c.w + 6;
    }
    li += t(x + 16, y + h - 12, narrow ? `% = repos con ≥${share}% de ese lenguaje` : `% = repos donde el lenguaje pesa al menos ${share}% / repos con código`, { c: C.mut, s: 10 });
    if (!m.langs.length) li += t(x + 16, y + 80, 'Aún no hay código para analizar.', { c: C.mid, s: 13, f: SANS });
    tile(x, y, w, h, 'Lenguajes por repos', li);
  } }; };

  S.repos = w => ({ h: 128, draw(x, y, h) {
    let r = ''; const n = Math.min(m.N, 24); const cw = (w - 32 - (Math.max(n, 1) - 1) * 4) / Math.max(n, 1);
    const privShare = m.N ? m.nPriv / m.N : 0;
    for (let i = 0; i < n; i++) { const isPriv = i >= n - Math.round(privShare * n); r += `<rect x="${(x + 16 + i * (cw + 4)).toFixed(1)}" y="${y + 40}" width="${cw.toFixed(1)}" height="20" rx="4" fill="${isPriv ? C.priv : C.pub}"/>`; }
    if (!n) r += `<rect x="${x + 16}" y="${y + 40}" width="${w - 32}" height="20" rx="4" fill="${C.track}"/>`;
    r += t(x + 16, y + 84, `${m.N} ${m.N === 1 ? 'repo' : 'repos'}`, { c: C.fg, s: 13, w: 700 }) + t(x + 16, y + 100, `${m.nPub} públicos · ${m.nPriv} privados`, { c: C.mid });
    r += t(x + 16, y + 116, `${(m.bytes / 1e6).toFixed(m.bytes < 1e7 ? 1 : 0)} MB de código`, { c: C.mut });
    tile(x, y, w, h, 'Tus repos', r);
  } });

  S.impact = w => ({ h: 128, draw(x, y, h) {
    let im = t(x + 16, y + 74, fmt(m.stars), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 16, y + 96, 'estrellas', { c: C.mut });
    im += t(x + 130, y + 74, fmt(m.forks), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 130, y + 96, 'forks', { c: C.mut });
    tile(x, y, w, h, 'Impacto', im);
  } });

  S.streaks = w => ({ h: 128, draw(x, y, h) {
    let rc = t(x + 16, y + 74, String(m.cur), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 16, y + 96, m.cur === 1 ? 'día seguido' : 'días seguidos', { c: C.mut });
    rc += t(x + 130, y + 74, String(m.best), { f: SANS, s: 38, w: 800, c: C.fg }) + t(x + 130, y + 96, 'mejor racha', { c: C.mut });
    rc += t(x + 16, y + 116, `${d.cc.contributionCalendar.totalContributions} contribuciones`, { c: C.mut, s: 10 });
    tile(x, y, w, h, 'Rachas, últimos 12 meses', rc);
  } });

  // En móvil, 53 semanas darían celdas de ~4 px: se muestran las últimas 26.
  S.heat = w => { const narrow = w < 500; return { h: 166, draw(x, y, h) {
    const all = d.cc.contributionCalendar.weeks, weeks = narrow ? all.slice(-26) : all;
    const step = (w - 32) / weeks.length, cs = step - 2.4;
    const max = Math.max(1, ...weeks.flatMap(wk => wk.contributionDays.map(c => c.contributionCount)));
    let s = ''; let lastMonth = -1, lastLbl = -9;
    weeks.forEach((wk, wi) => {
      const first = wk.contributionDays[0]; if (first) { const mo = new Date(first.date).getUTCMonth(); if (mo !== lastMonth) { lastMonth = mo; if (wi - lastLbl >= 3 && wi < weeks.length - 2) { lastLbl = wi; s += t(x + 16 + wi * step, y + 40, ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][mo], { c: C.mut, s: 9 }); } } }
      for (const c of wk.contributionDays) { const q = c.contributionCount / max; const lv = c.contributionCount === 0 ? 0 : q > .75 ? 4 : q > .5 ? 3 : q > .25 ? 2 : 1;
        s += `<rect x="${(x + 16 + wi * step).toFixed(1)}" y="${y + 48 + c.weekday * (cs + 2.4)}" width="${cs.toFixed(1)}" height="${cs.toFixed(1)}" rx="2" fill="${C.heat[lv]}"/>`; }
    });
    // Leyenda "menos ▢▢▢▢▢ más", alineada a la derecha del título.
    let lx = x + w - 16;
    s += t(lx, y + 24, 'más', { c: C.mut, s: 9, a: 'end' }); lx -= tw('más', 9) + 6;
    for (let lv = 4; lv >= 0; lv--) { lx -= 10; s += `<rect x="${lx.toFixed(1)}" y="${y + 15}" width="10" height="10" rx="2" fill="${C.heat[lv]}"/>`; lx -= 3; }
    s += t(lx - 3, y + 24, 'menos', { c: C.mut, s: 9, a: 'end' });
    tile(x, y, w, h, `Contribuciones, últimos ${narrow ? 6 : 12} meses`, s);
  } }; };

  S.types = w => ({ h: 172, draw(x, y, h) {
    const cc = d.cc;
    const parts = [['Commits', cc.totalCommitContributions, '#39d353'], ['PRs', cc.totalPullRequestContributions, '#58a6ff'], ['Reviews', cc.totalPullRequestReviewContributions, '#a371f7'], ['Issues', cc.totalIssueContributions, '#e3b341']];
    const tot = parts.reduce((s, p) => s + p[1], 0) || 1; let bx = x + 16, s = '';
    parts.forEach(p => { const bw = Math.max(0, (w - 32 - 6) * p[1] / tot); if (bw > 0) s += `<rect x="${bx.toFixed(1)}" y="${y + 40}" width="${bw.toFixed(1)}" height="10" rx="2" fill="${p[2]}"/>`; bx += bw + 2; });
    parts.forEach((p, i) => { s += `<rect x="${x + 16}" y="${y + 70 + i * 24 - 8}" width="8" height="8" rx="2" fill="${p[2]}"/>` + t(x + 32, y + 70 + i * 24, p[0], { c: C.mid }) + t(x + w - 16, y + 70 + i * 24, String(p[1]), { c: C.fg, a: 'end' }); });
    tile(x, y, w, h, 'Tipo de actividad', s);
  } });

  S.weekday = w => ({ h: 172, draw(x, y, h) {
    const order = [1, 2, 3, 4, 5, 6, 0]; const mx = Math.max(1, ...m.wk); const top = m.wk.indexOf(Math.max(...m.wk));
    let s = ''; const bw = (w - 32 - 6 * 8) / 7;
    order.forEach((di, i) => { const bh = Math.max(3, 70 * m.wk[di] / mx); s += `<rect x="${(x + 16 + i * (bw + 8)).toFixed(1)}" y="${y + 120 - bh}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${di === top && m.wk[di] ? C.barHi : C.bar}"/>` + t(x + 16 + i * (bw + 8) + bw / 2, y + 134, DAYS[di], { s: 10, c: C.mut, a: 'middle' }); });
    s += m.wk[top] ? t(x + 16, y + 158, `Pico los ${DAYS_FULL[top]}`, { c: C.mid }) : '';
    tile(x, y, w, h, 'Día más activo', s);
  } });

  S.now = w => ({ h: 172, draw(x, y, h) {
    const n = cfg.now || {};
    tile(x, y, w, h, 'Ahora mismo', kv(x + 16, y + 54, [['construyendo', n.building], ['aprendiendo', n.learning], ['leyendo', n.reading], ['pregúntame', n.askMe]], w, { step: 26, lines: 2, maxY: y + h - 16 }) || t(x + 16, y + 56, 'Completa "now" en profile.json', { c: C.mut }));
  } });

  S.featured = w => ({ h: 186, draw(x, y, h) {
    const feat = pickFeatured(m); let s = '';
    feat.forEach((r, i) => { const yy = y + 52 + i * 44;
      const meta = `★ ${r.stargazerCount} · ${ago(r.pushedAt)}`, langW = r.primaryLanguage ? tw(r.primaryLanguage.name, 10) + 30 : 0;
      s += t(x + 16, yy, clip(r.name, w - 32 - tw(meta, 10) - 16, 13), { c: C.link, s: 13, w: 500 }) + t(x + 16, yy + 15, clip(r.description || 'Sin descripción', w - 32 - langW, 12, SANS), { f: SANS, s: 12, c: C.mid });
      s += t(x + w - 16, yy, meta, { c: C.mut, a: 'end', s: 10 });
      if (r.primaryLanguage) {
        const lc = legible(r.primaryLanguage.color || r.languages.edges[0]?.node.color || '#8b949e', C.tile, toward);
        s += `<circle cx="${(x + w - 16 - tw(r.primaryLanguage.name, 10) - 8).toFixed(1)}" cy="${yy + 11.5}" r="4" fill="${lc}"/>` + t(x + w - 16, yy + 15, r.primaryLanguage.name, { c: C.mut, a: 'end', s: 10 });
      } });
    if (!feat.length) s += t(x + 16, y + 60, 'Aquí aparecerán tus proyectos públicos destacados.', { c: C.mid, f: SANS, s: 13 });
    tile(x, y, w, h, 'Proyectos destacados', s);
  } });

  S.recent = w => ({ h: 186, draw(x, y, h) {
    // La API ya no trae pull_request.merged: un PR fusionado llega como action "merged".
    const PR = { merged: 'PR fusionado en ', opened: 'PR abierto en ', closed: 'PR cerrado en ', reopened: 'PR reabierto en ' };
    const label = e => { const rn = e.repo.name.split('/')[1] || e.repo.name, p = e.payload || {};
      switch (e.type) { case 'PushEvent': return ['push a ', rn]; case 'PullRequestEvent': return [p.pull_request?.merged ? PR.merged : PR[p.action] || 'PR en ', rn];
        case 'PullRequestReviewEvent': return ['review en ', rn]; case 'ReleaseEvent': return ['release ', p.release?.tag_name || rn]; case 'CreateEvent': return p.ref_type === 'repository' ? ['repo creado ', rn] : null;
        case 'IssuesEvent': return [p.action === 'opened' ? 'issue abierto en ' : p.action === 'closed' ? 'issue cerrado en ' : 'issue en ', rn]; default: return null; } };
    // La API no garantiza el orden: se ordena por fecha y se agrupan los eventos iguales seguidos (×N).
    const evs = [];
    for (const e of [...(d.events || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
      const l = label(e); if (!l) continue;
      const prev = evs[evs.length - 1];
      if (prev && prev.l[0] === l[0] && prev.l[1] === l[1]) prev.n++; else evs.push({ l, at: e.created_at, n: 1 });
    }
    evs.splice(5); let s = '';
    evs.forEach((e, i) => { const [pre, nm] = e.l, when = ago(e.at), yy = y + 52 + i * 26, cnt = e.n > 1 ? `×${e.n}` : '';
      const name = clip(nm, w - 34 - 16 - tw(pre) - (cnt ? tw(cnt) + 6 : 0) - tw(when, 10) - 8), nx = x + 34 + tw(pre);
      s += `<circle cx="${x + 22}" cy="${yy - 4}" r="3" fill="${C.green}"/>` + t(x + 34, yy, pre, { c: C.mid }) + t(nx, yy, name, { c: C.fg })
        + (cnt ? t(nx + tw(name) + 6, yy, cnt, { c: C.mut }) : '') + t(x + w - 16, yy, when, { c: C.mut, a: 'end', s: 10 }); });
    if (!evs.length) s += t(x + 16, y + 56, 'Sin actividad pública reciente.', { c: C.mid });
    tile(x, y, w, h, 'Actividad reciente', s);
  } });

  S.stack = w => {
    const custom = cfg.stack?.length, items = (custom ? cfg.stack : m.langs.slice(0, 10).map(l => l.name)).map(s => ({ s, pad: 20 }));
    const { placed, rows } = flow(items, 16, w - 16, 3, 'el stack');
    return { h: 68 + (rows - 1) * 28, draw(x, y, h) {
      tile(x, y, w, h, custom ? 'Stack y herramientas' : 'Stack (según tus repos)', placed.map(p => chip(x + p.x, y + 34 + p.row * 28, p.s, true).svg).join(''));
    } };
  };

  const layout = mobile
    ? ['identity', 'account', 'hero', 'langs', 'repos', 'impact', 'streaks', 'heat', 'types', 'weekday', 'now', 'featured', 'recent', 'stack'].map(k => [[k, IN]])
    : [[['identity', B], ['account', A]], [['hero', A], ['langs', B]], [['repos', A], ['impact', A], ['streaks', A]], [['heat', IN]],
      [['types', A], ['weekday', A], ['now', A]], [['featured', B], ['recent', A]], [['stack', IN]]];
  let y = P;
  for (const row of layout) {
    const secs = row.map(([k, w]) => ({ w, ...S[k](w) })), h = Math.max(...secs.map(s => s.h));
    let x = P; for (const s of secs) { s.draw(x, y, h); x += s.w + G; }
    y += h + G;
  }

  const priv = 'Los repos privados solo suman a los números, nunca se muestran por nombre';
  body += t(P, y + 12, `Actualizado automáticamente · ${NOW.toISOString().slice(0, 10)} UTC`, { c: C.mut, s: 10 });
  let H;
  if (mobile) { const ls = wrap(priv, IN, 2, 10); ls.forEach((l, i) => { body += t(P, y + 28 + i * 14, l, { c: C.mut, s: 10 }); }); H = y + 28 + (ls.length - 1) * 14 + P; }
  else { body += t(P + IN, y + 12, priv, { c: C.mut, s: 10, a: 'end' }); H = y + 12 + P; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary(d, m))}">
<style>.ring{animation:draw 1.2s ease-out both}@keyframes draw{from{stroke-dashoffset:var(--c)}}@media (prefers-reduced-motion:reduce){.ring{animation:none}}</style>
<rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>${body}</svg>`;
}

/* ---------- main ---------- */
let data;
try { data = SAMPLE ? sampleData() : await fetchData(); }
catch (e) {
  // Todo o nada: sin datos completos no se toca stats/ y el workflow queda en rojo.
  console.error(`${process.env.GITHUB_ACTIONS ? '::error::' : ''}No se generaron los SVG. ${e.message}`);
  process.exit(1);
}
const m = compute(data);
mkdirSync(OUT, { recursive: true });
for (const th of ['dark', 'light']) {
  writeFileSync(join(OUT, `bento-${th}.svg`), render(data, m, th));
  writeFileSync(join(OUT, `bento-mobile-${th}.svg`), render(data, m, th, true));
}
// El alt del README se actualiza solo en una generación real (sin --out), no en las vistas previas.
if (outArg === -1) {
  const readme = join(ROOT, 'README.md'), src = readFileSync(readme, 'utf8');
  const next = src.replace(/(<img alt=")[^"]*(")/, (_, a, b) => a + esc(summary(data, m)) + b);
  if (next === src && !src.includes('<img alt="')) console.warn('Aviso: no encontré <img alt="…"> en README.md');
  else if (next !== src) writeFileSync(readme, next);
}
console.log(`OK ${data.login} → ${OUT}: ${m.N} repos (${m.nPub} públicos, ${m.nPriv} privados), top: ${m.langs.slice(0, 3).map(l => `${l.name} ${l.n}/${m.NL}`).join(', ') || '-'}`);
