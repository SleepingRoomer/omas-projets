// Planning généré à partir des projets : dates des projets, jalons (communication, logistique, bilan),
// décisions à rendre. Consultable dans Cap et en abonnement dans n'importe quel agenda (lien iCal personnel).
import { Hono } from 'hono';
import { PLANNING_KINDS, TYPES, addDays, APP_NAME } from '../public/js/shared.js';
import { all, one, run, httpError, today, need, postsOf } from './util.js';
import { siteUrl } from './mail.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VISIBLE = "('valide','realise','cloture')";

function projectItem(p, kind = null) {
  return {
    date: p.starts_at, end: p.ends_at && p.ends_at !== p.starts_at ? p.ends_at : null, time: p.start_time || null,
    kind: kind || (p.status === 'depose' ? 'instruction' : 'projet'), title: p.title, project_id: p.id, code: p.code, status: p.status,
    unit_code: p.unit_code, domain: p.domain, location: p.location, owner_name: p.owner_name, type: p.type,
  };
}

// Éléments du planning. scope = 'me' (ce qui me concerne) ou 'all' (la localité)
export async function planningItems(db, me, scope, from, to) {
  const items = [];
  const pid = me.person?.id ?? 0;
  const myPosts = me.posts.map((p) => p.id);
  const base = `SELECT p.id, p.title, p.code, p.status, p.type, p.starts_at, p.ends_at, p.start_time, p.location, p.plan_com, p.plan_logi, p.domain, p.owner_id, u.code AS unit_code, o.name AS owner_name
    FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id`;
  if (scope === 'all') {
    const wide = me.admin || me.flags.isBureau || me.flags.isTreasurer || me.flags.isHead;
    const rows = await all(db, `${base} WHERE p.starts_at BETWEEN ? AND ? AND p.status IN ${wide ? "('valide','realise','cloture','depose')" : VISIBLE} ORDER BY p.starts_at, p.start_time`, from, to);
    for (const p of rows) items.push(projectItem(p));
    return items;
  }
  // mes projets (porteur, co-porteur) et ceux sur lesquels j'ai accepté une collaboration
  const solicitedClause = myPosts.length ? ` OR p.id IN (SELECT project_id FROM requests WHERE status = 'acceptee' AND to_post_id IN (${myPosts.map(() => '?').join(',')}))` : '';
  const mine = await all(db, `${base} WHERE (p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE person_id = ?)${solicitedClause})
      AND p.status IN ('depose','complement','ajourne','valide','realise','cloture')
      AND (p.starts_at BETWEEN ? AND ? OR p.plan_com BETWEEN ? AND ? OR p.plan_logi BETWEEN ? AND ? OR p.starts_at BETWEEN ? AND ?)`,
  pid, pid, ...myPosts, from, to, from, to, from, to, addDays(from, -15), addDays(to, -15)).catch(() => []);
  const memberOf = new Set((await all(db, 'SELECT project_id FROM project_members WHERE person_id = ?', pid)).map((x) => x.project_id));
  for (const p of mine) {
    const iAmOwner = p.owner_id === pid || memberOf.has(p.id);
    if (p.starts_at >= from && p.starts_at <= to) items.push(projectItem(p));
    if (!['valide', 'realise'].includes(p.status) || !iAmOwner) continue;
    if (p.plan_com && p.plan_com >= from && p.plan_com <= to) items.push({ ...projectItem(p, 'com'), date: p.plan_com, end: null, time: null });
    if (p.plan_logi && p.plan_logi >= from && p.plan_logi <= to) items.push({ ...projectItem(p, 'logi'), date: p.plan_logi, end: null, time: null });
    const bilan = addDays(p.ends_at || p.starts_at, 15);
    if (bilan >= from && bilan <= to) items.push({ ...projectItem(p, 'bilan'), date: bilan, end: null, time: null });
  }
  // décisions que j'ai à rendre
  if (myPosts.length) {
    const dec = await all(db, `SELECT a.due_at, p.id, p.title, p.code, p.status, p.type, p.starts_at, p.ends_at, p.start_time, p.location, p.domain, u.code AS unit_code, o.name AS owner_name
      FROM approvals a JOIN projects p ON p.id = a.project_id JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id
      WHERE a.decision = 'pending' AND p.status = 'depose' AND p.owner_id != ? AND a.post_id IN (${myPosts.map(() => '?').join(',')})`, pid, ...myPosts);
    const seen = new Set();
    for (const d of dec) {
      if (seen.has(d.id)) continue; seen.add(d.id);
      const date = (d.due_at || '').slice(0, 10) || today();
      const shown = date < today() ? today() : date; // une décision en retard s'affiche aujourd'hui
      if (shown >= from && shown <= to) items.push({ ...projectItem(d, 'decision'), date: shown, end: null, time: null, late: date < today() });
    }
  }
  return items.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

// ---------- iCal ----------
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  // lignes de 75 octets au plus, suite précédée d'une espace
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const compact = (d) => d.replace(/-/g, '');
function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const t = h * 60 + m + mins;
  return t >= 24 * 60 ? null : `${String(Math.floor(t / 60)).padStart(2, '0')}${String(t % 60).padStart(2, '0')}00`;
}

export function toIcs(items, { name, base }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//OMAS IDF//${APP_NAME}//FR`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(name)}`, 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const it of items) {
    const prefix = { projet: '', instruction: '[En instruction] ', com: 'Lancer la com : ', logi: 'Confirmer la logistique : ', bilan: 'Bilan à déposer : ', decision: 'Décision à rendre : ' }[it.kind] ?? '';
    lines.push('BEGIN:VEVENT', `UID:cap-${it.kind === 'instruction' ? 'projet' : it.kind}-${it.project_id}-${it.date}@omas-idf`, `DTSTAMP:${stamp}`);
    const end = addMinutes(it.time || '00:00', 120);
    if (it.time && (it.kind === 'projet' || it.kind === 'instruction') && end) {
      lines.push(`DTSTART;TZID=Europe/Paris:${compact(it.date)}T${it.time.replace(':', '')}00`, `DTEND;TZID=Europe/Paris:${compact(it.end || it.date)}T${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(it.date)}`, `DTEND;VALUE=DATE:${compact(addDays(it.end || it.date, 1))}`);
    }
    lines.push(`SUMMARY:${icsEsc(prefix + it.title)}`);
    if (it.location && (it.kind === 'projet' || it.kind === 'instruction')) lines.push(`LOCATION:${icsEsc(it.location)}`);
    lines.push(`DESCRIPTION:${icsEsc([PLANNING_KINDS[it.kind], it.code, TYPES[it.type], `${it.unit_code} · ${it.owner_name}`, `${base}/#/projet/${it.project_id}`].filter(Boolean).join('\n'))}`);
    lines.push(`URL:${base}/#/projet/${it.project_id}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function genToken() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function registerPlanning(app) {
  const r = new Hono();

  r.get('/planning', need(), async (c) => {
    const q = c.req.query();
    const from = DATE.test(q.from || '') ? q.from : today();
    const to = DATE.test(q.to || '') ? q.to : addDays(from, 62);
    if (to < from || addDays(from, 400) < to) throw httpError(400, 'Période invalide');
    return c.json(await planningItems(c.env.DB, c.get('me'), q.scope === 'all' ? 'all' : 'me', from, to));
  });

  // Lien d'abonnement personnel. Le lien suffit pour lire : on peut le régénérer pour couper un ancien lien.
  r.get('/planning/ical', need(), async (c) => {
    const me = c.get('me');
    if (!me.person) return c.json({ url: null });
    const row = await one(c.env.DB, 'SELECT ical_token FROM people WHERE id = ?', me.person.id).catch(() => null);
    const base = siteUrl(c.env, c);
    return c.json({ url: row?.ical_token ? `${base}/api/ical/${row.ical_token}.ics` : null });
  });
  r.post('/planning/ical', need(), async (c) => {
    const me = c.get('me');
    if (!me.person) throw httpError(403, 'Réservé aux comptes personnels');
    const token = genToken();
    await run(c.env.DB, 'UPDATE people SET ical_token = ? WHERE id = ?', token, me.person.id);
    return c.json({ url: `${siteUrl(c.env, c)}/api/ical/${token}.ics` });
  });

  r.get('/ical/:file', async (c) => {
    const token = c.req.param('file').replace(/\.ics$/, '');
    if (!/^[a-f0-9]{48}$/.test(token)) throw httpError(404, 'Introuvable');
    const db = c.env.DB;
    const person = await one(db, 'SELECT id, name, is_admin FROM people WHERE ical_token = ? AND active = 1', token);
    if (!person) throw httpError(404, 'Introuvable');
    const posts = await postsOf(db, person.id);
    const me = { person, posts, admin: !!person.is_admin, flags: { isBureau: posts.some((p) => p.is_bureau), isTreasurer: posts.some((p) => p.is_treasurer), isHead: posts.some((p) => p.is_head) } };
    const scope = c.req.query('scope') === 'all' ? 'all' : 'me';
    const from = addDays(today(), -30); const to = addDays(today(), 240);
    const items = await planningItems(db, me, scope, from, to);
    const base = siteUrl(c.env, c);
    const name = scope === 'all' ? `${APP_NAME} · OMAS IDF` : `${APP_NAME} · mon planning`;
    return new Response(toIcs(items, { name, base }), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=900', 'x-content-type-options': 'nosniff' } });
  });

  app.route('/', r);
}
