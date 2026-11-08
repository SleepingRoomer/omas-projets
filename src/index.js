import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { DEFAULT_RULES, APP_NAME } from '../public/js/shared.js';
import { sendMails, magicLinkMail, siteUrl, later, mailReady } from './mail.js';
import { parse, httpError, all, one, run, today, str, bool, getRules, postsOf, need } from './util.js';
import { registerProjects, runDaily } from './projects.js';

const app = new Hono().basePath('/api');
const COOKIE = 'cap_s';

// ---------- utilitaires ----------
function genToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

app.onError((err, c) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  return c.json({ error: err.message || 'Erreur serveur' }, status);
});

// Écritures acceptées seulement depuis nos propres pages ; réponses jamais mises en cache
app.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw httpError(403, 'Origine refusée');
  }
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
});

// ---------- sessions et identité ----------
async function createSession(c, personId, kind = 'person', hours = 24 * 30) {
  const token = genToken();
  const expires = new Date(Date.now() + hours * 3600e3).toISOString();
  await run(c.env.DB, 'INSERT INTO auth_sessions (token, person_id, kind, expires_at) VALUES (?,?,?,?)', token, personId ?? null, kind, expires);
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: hours * 3600, secure: new URL(c.req.url).protocol === 'https:' });
}

export async function identity(db, session) {
  if (!session) return null;
  const person = session.person_id ? await one(db, 'SELECT id, name, email, phone, is_admin, active FROM people WHERE id = ?', session.person_id) : null;
  if (session.kind === 'person' && (!person || !person.active)) return null;
  const posts = await postsOf(db, person?.id);
  const isAdmin = session.kind === 'admin' || !!person?.is_admin;
  const hasChildren = posts.length ? (await one(db, `SELECT COUNT(*) AS n FROM posts WHERE active = 1 AND parent_id IN (${posts.map(() => '?').join(',')})`, ...posts.map((p) => p.id))).n > 0 : false;
  return {
    person, posts, admin: isAdmin,
    flags: {
      isAdmin, isBureau: posts.some((p) => p.is_bureau), isTreasurer: posts.some((p) => p.is_treasurer), isHead: posts.some((p) => p.is_head),
      isValidator: isAdmin || hasChildren || posts.some((p) => p.is_bureau || p.is_treasurer),
    },
  };
}

app.use('*', async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (token) {
    const s = await one(c.env.DB, 'SELECT * FROM auth_sessions WHERE token = ? AND expires_at > ?', token, new Date().toISOString());
    if (s) { const me = await identity(c.env.DB, s); if (me) { c.set('me', me); c.set('session', s); } }
  }
  await next();
});

const clientIp = (c) => c.req.header('CF-Connecting-IP') || 'local';
async function checkAttempts(c, limit) {
  const r = await one(c.env.DB, "SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > datetime('now', '-15 minutes')", clientIp(c));
  if (r.n >= limit) throw httpError(429, 'Trop de tentatives : réessaie dans 15 minutes.');
}
const failed = (c) => run(c.env.DB, 'INSERT INTO login_failures (ip) VALUES (?)', clientIp(c));

async function issueLink(db, env, c, person) {
  const token = genToken();
  const expires = new Date(Date.now() + 30 * 60e3).toISOString();
  await run(db, 'INSERT INTO magic_links (token, person_id, expires_at) VALUES (?,?,?)', token, person.id, expires);
  return `${siteUrl(env, c)}/#/connexion/${token}`;
}

// Demande de lien : réponse identique que l'adresse existe ou non
app.post('/auth/request', async (c) => {
  await checkAttempts(c, 10);
  const { email } = await c.req.json();
  const person = await one(c.env.DB, 'SELECT * FROM people WHERE email = ? AND active = 1', String(email || '').trim());
  if (!person) { await failed(c); return c.json({ ok: true, sent: mailReady(c.env) }); }
  const url = await issueLink(c.env.DB, c.env, c, person);
  if (mailReady(c.env)) later(c, sendMails(c.env, c.env.DB, [magicLinkMail({ to: person.email, name: person.name, url })]));
  // en local sans Brevo, le lien est renvoyé pour pouvoir tester
  return c.json({ ok: true, sent: mailReady(c.env), ...(c.env.DEV_LINKS === '1' && !mailReady(c.env) ? { link: url } : {}) });
});

app.post('/auth/consume', async (c) => {
  await checkAttempts(c, 20);
  const { token } = await c.req.json();
  const l = await one(c.env.DB, 'SELECT * FROM magic_links WHERE token = ?', String(token || ''));
  if (!l || l.used_at || l.expires_at < new Date().toISOString()) { await failed(c); throw httpError(401, 'Ce lien n\'est plus valable. Demande-en un nouveau.'); }
  const person = await one(c.env.DB, 'SELECT * FROM people WHERE id = ? AND active = 1', l.person_id);
  if (!person) throw httpError(401, 'Compte désactivé');
  await run(c.env.DB, "UPDATE magic_links SET used_at = datetime('now') WHERE token = ?", l.token);
  await run(c.env.DB, "UPDATE people SET last_login_at = datetime('now') WHERE id = ?", person.id);
  await createSession(c, person.id);
  return c.json({ ok: true });
});

// Accès technique de démarrage : sert à créer les premières personnes, puis chacun se connecte par e-mail
app.post('/auth/admin', async (c) => {
  await checkAttempts(c, 8);
  const { password } = await c.req.json();
  if (!c.env.ADMIN_PASSWORD || !safeEqual(password, c.env.ADMIN_PASSWORD)) { await failed(c); throw httpError(401, 'Mot de passe incorrect'); }
  await createSession(c, null, 'admin', 24);
  return c.json({ ok: true });
});

app.post('/logout', async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await run(c.env.DB, 'DELETE FROM auth_sessions WHERE token = ?', token);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/me', async (c) => {
  const me = c.get('me');
  if (!me) return c.json({ anonymous: true, mail: mailReady(c.env) });
  const rules = await getRules(c.env.DB);
  const units = await all(c.env.DB, 'SELECT id, code, name, kind, parent_id FROM units WHERE active = 1 ORDER BY sort');
  return c.json({ ...me, rules, units, mail: mailReady(c.env) });
});

// ---------- organigramme (lecture : tout le monde connecté) ----------
app.get('/org', need(), async (c) => {
  const db = c.env.DB;
  const units = await all(db, 'SELECT * FROM units ORDER BY sort');
  const posts = await all(db, 'SELECT * FROM posts ORDER BY unit_id, sort');
  const holders = await all(db, `SELECT a.id AS assignment_id, a.post_id, a.person_id, a.start_date, a.end_date, p.name, p.email FROM assignments a JOIN people p ON p.id = a.person_id
    WHERE p.active = 1 AND (a.end_date IS NULL OR a.end_date >= ?) ORDER BY p.name`, today());
  const deputies = await all(db, 'SELECT d.*, p.name FROM deputies d JOIN people p ON p.id = d.person_id WHERE d.end_date >= ? ORDER BY d.start_date', today());
  const me = c.get('me');
  return c.json({ units, posts, holders: holders.map((h) => (me.admin ? h : { ...h, email: undefined })), deputies });
});

// Suppléance : le titulaire d'un poste (ou l'admin) désigne quelqu'un pour une période
app.post('/deputies', need(), async (c) => {
  const me = c.get('me');
  const b = await c.req.json();
  const postId = Number(b.post_id);
  if (!me.admin && !me.posts.some((p) => p.id === postId && !p.deputy)) throw httpError(403, 'Seul le titulaire du poste peut désigner un suppléant');
  if (!b.start_date || !b.end_date || b.end_date < b.start_date) throw httpError(400, 'Période incomplète');
  const person = await one(c.env.DB, 'SELECT id FROM people WHERE id = ? AND active = 1', Number(b.person_id));
  if (!person) throw httpError(404, 'Personne introuvable');
  await run(c.env.DB, 'INSERT INTO deputies (post_id, person_id, start_date, end_date, created_by) VALUES (?,?,?,?,?)', postId, person.id, b.start_date, b.end_date, me.person?.id ?? null);
  return c.json({ ok: true });
});
app.delete('/deputies/:id', need(), async (c) => {
  const me = c.get('me');
  const d = await one(c.env.DB, 'SELECT * FROM deputies WHERE id = ?', Number(c.req.param('id')));
  if (!d) throw httpError(404, 'Introuvable');
  if (!me.admin && !me.posts.some((p) => p.id === d.post_id && !p.deputy)) throw httpError(403, 'Accès refusé');
  await run(c.env.DB, 'DELETE FROM deputies WHERE id = ?', d.id);
  return c.json({ ok: true });
});

// Liste des personnes (pour les co-porteurs et les suppléances) : nom seulement
app.get('/people', need(), async (c) => c.json(await all(c.env.DB, 'SELECT id, name FROM people WHERE active = 1 ORDER BY name')));

// ---------- administration ----------
const admin = new Hono();
admin.use('*', need('isAdmin'));

admin.get('/people', async (c) => c.json(await all(c.env.DB, `SELECT p.*, (SELECT COUNT(*) FROM assignments a WHERE a.person_id = p.id AND (a.end_date IS NULL OR a.end_date >= ?)) AS n_posts FROM people p ORDER BY p.active DESC, p.name`, today())));
admin.post('/people', async (c) => {
  const b = await c.req.json();
  const name = str(b.name, 120); const email = str(b.email, 200)?.toLowerCase();
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'Nom et adresse e-mail valides requis');
  const r = await run(c.env.DB, 'INSERT INTO people (name, email, phone, is_admin) VALUES (?,?,?,?)', name, email, str(b.phone, 30), bool(b.is_admin)).catch(() => null);
  if (!r) throw httpError(409, 'Cette adresse existe déjà');
  return c.json({ id: r.meta.last_row_id });
});
admin.put('/people/:id', async (c) => {
  const b = await c.req.json(); const id = Number(c.req.param('id'));
  const p = await one(c.env.DB, 'SELECT * FROM people WHERE id = ?', id);
  if (!p) throw httpError(404, 'Introuvable');
  const email = str(b.email ?? p.email, 200)?.toLowerCase();
  const r = await run(c.env.DB, 'UPDATE people SET name = ?, email = ?, phone = ?, is_admin = ?, active = ? WHERE id = ?',
    str(b.name ?? p.name, 120), email, str(b.phone ?? p.phone, 30), bool(b.is_admin ?? p.is_admin), bool(b.active ?? p.active), id).catch(() => null);
  if (!r) throw httpError(409, 'Cette adresse existe déjà');
  if (b.active === false) await run(c.env.DB, 'DELETE FROM auth_sessions WHERE person_id = ?', id);
  return c.json({ ok: true });
});
// Lien de connexion fabriqué par l'admin : utile tant que Brevo n'est pas branché, ou pour dépanner
admin.post('/people/:id/link', async (c) => {
  const p = await one(c.env.DB, 'SELECT * FROM people WHERE id = ? AND active = 1', Number(c.req.param('id')));
  if (!p) throw httpError(404, 'Introuvable');
  const url = await issueLink(c.env.DB, c.env, c, p);
  let sent = false;
  if (mailReady(c.env) && (await c.req.json().catch(() => ({})))?.send) { await sendMails(c.env, c.env.DB, [magicLinkMail({ to: p.email, name: p.name, url })]); sent = true; }
  return c.json({ url, sent });
});

admin.post('/assign', async (c) => {
  const b = await c.req.json();
  const r = await run(c.env.DB, 'INSERT INTO assignments (person_id, post_id, start_date, end_date) VALUES (?,?,?,?) ON CONFLICT(person_id, post_id) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date',
    Number(b.person_id), Number(b.post_id), b.start_date || null, b.end_date || null);
  return c.json({ id: r.meta.last_row_id });
});
admin.delete('/assign/:id', async (c) => { await run(c.env.DB, 'DELETE FROM assignments WHERE id = ?', Number(c.req.param('id'))); return c.json({ ok: true }); });

admin.post('/units', async (c) => {
  const b = await c.req.json();
  const code = str(b.code, 8)?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code || !str(b.name)) throw httpError(400, 'Code et nom requis');
  const r = await run(c.env.DB, 'INSERT INTO units (code, name, kind, parent_id, sort) VALUES (?,?,?,?,?)', code, str(b.name, 120), str(b.kind, 20) || 'antenne', b.parent_id ? Number(b.parent_id) : null, Number(b.sort) || 0).catch(() => null);
  if (!r) throw httpError(409, 'Ce code existe déjà');
  return c.json({ id: r.meta.last_row_id });
});
admin.put('/units/:id', async (c) => {
  const b = await c.req.json(); const id = Number(c.req.param('id'));
  const u = await one(c.env.DB, 'SELECT * FROM units WHERE id = ?', id);
  if (!u) throw httpError(404, 'Introuvable');
  await run(c.env.DB, 'UPDATE units SET name = ?, kind = ?, parent_id = ?, sort = ?, active = ? WHERE id = ?', str(b.name ?? u.name, 120), str(b.kind ?? u.kind, 20), b.parent_id === undefined ? u.parent_id : (b.parent_id ? Number(b.parent_id) : null), Number(b.sort ?? u.sort) || 0, bool(b.active ?? u.active), id);
  return c.json({ ok: true });
});
admin.post('/posts', async (c) => {
  const b = await c.req.json();
  if (!b.unit_id || !str(b.label)) throw httpError(400, 'Structure et intitulé requis');
  const r = await run(c.env.DB, 'INSERT INTO posts (unit_id, code, label, domain, parent_id, functional_id, is_bureau, is_treasurer, is_head, sort) VALUES (?,?,?,?,?,?,?,?,?,?)',
    Number(b.unit_id), str(b.code, 30) || 'autre', str(b.label, 120), str(b.domain, 5)?.toUpperCase() || null, b.parent_id ? Number(b.parent_id) : null, b.functional_id ? Number(b.functional_id) : null,
    bool(b.is_bureau), bool(b.is_treasurer), bool(b.is_head), Number(b.sort) || 0);
  return c.json({ id: r.meta.last_row_id });
});
admin.put('/posts/:id', async (c) => {
  const b = await c.req.json(); const id = Number(c.req.param('id'));
  const p = await one(c.env.DB, 'SELECT * FROM posts WHERE id = ?', id);
  if (!p) throw httpError(404, 'Introuvable');
  const parent = b.parent_id === undefined ? p.parent_id : (b.parent_id ? Number(b.parent_id) : null);
  if (parent === id) throw httpError(400, 'Un poste ne peut pas dépendre de lui-même');
  await run(c.env.DB, 'UPDATE posts SET unit_id = ?, code = ?, label = ?, domain = ?, parent_id = ?, functional_id = ?, is_bureau = ?, is_treasurer = ?, is_head = ?, sort = ?, active = ? WHERE id = ?',
    Number(b.unit_id ?? p.unit_id), str(b.code ?? p.code, 30), str(b.label ?? p.label, 120), (str(b.domain ?? p.domain, 5) || null)?.toUpperCase() ?? null, parent,
    b.functional_id === undefined ? p.functional_id : (b.functional_id ? Number(b.functional_id) : null),
    bool(b.is_bureau ?? p.is_bureau), bool(b.is_treasurer ?? p.is_treasurer), bool(b.is_head ?? p.is_head), Number(b.sort ?? p.sort) || 0, bool(b.active ?? p.active), id);
  return c.json({ ok: true });
});

admin.get('/settings', async (c) => c.json({ rules: await getRules(c.env.DB) }));
admin.put('/settings', async (c) => {
  const b = await c.req.json();
  const rules = { ...DEFAULT_RULES, ...(b.rules || {}) };
  rules.l1 = Math.max(0, Number(rules.l1) || 0); rules.l2 = Math.max(rules.l1, Number(rules.l2) || 0); rules.quorum = Math.max(1, Number(rules.quorum) || 1);
  await run(c.env.DB, "INSERT INTO settings (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(rules));
  return c.json({ rules });
});
admin.get('/mails', async (c) => c.json(await all(c.env.DB, 'SELECT * FROM mail_log ORDER BY id DESC LIMIT 200')));
admin.get('/state', async (c) => {
  const db = c.env.DB;
  const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
  const cron = await one(db, 'SELECT * FROM cron_log ORDER BY id DESC LIMIT 1').catch(() => null);
  return c.json({ tables, mail: mailReady(c.env), lastCron: cron, app: APP_NAME, siteUrl: siteUrl(c.env, c) });
});
admin.post('/cron', async (c) => c.json(await runDaily(c.env, c)));

app.route('/admin', admin);
registerProjects(app);

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) { ctx.waitUntil(runDaily(env)); },
};
