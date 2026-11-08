// Demandes entre responsables : informer un pôle, demander un avis, proposer une collaboration.
// Une demande part d'une personne vers un POSTE (donc vers qui le tient, suppléant compris), avec un fil d'échange.
// Objectif : que ces échanges vivent dans Cap, rattachés au projet, et plus dans les groupes WhatsApp.
import { Hono } from 'hono';
import { REQUEST_KINDS, REQUEST_STATUSES } from '../public/js/shared.js';
import { all, one, run, httpError, str, holdersOf, need, today } from './util.js';
import { sendMails, layout, esc, siteUrl, later } from './mail.js';

const MAX_TARGETS = 12;

// Qui peut voir et agir sur une demande
async function requestAccess(db, me, r) {
  const myPosts = me.posts.map((p) => p.id);
  const isSender = !!me.person && r.from_person_id === me.person.id;
  const isTarget = myPosts.includes(r.to_post_id);
  let onProject = false;
  if (r.project_id && me.person) {
    const p = await one(db, 'SELECT owner_id FROM projects WHERE id = ?', r.project_id);
    onProject = p?.owner_id === me.person.id || !!(await one(db, 'SELECT 1 AS x FROM project_members WHERE project_id = ? AND person_id = ?', r.project_id, me.person.id));
  }
  const side = isTarget ? 'target' : (isSender || onProject) ? 'sender' : me.admin ? 'admin' : null;
  return {
    side,
    canSee: !!side,
    canReply: !!me.person && !!side && side !== 'admin' && r.status !== 'close',
    canAnswer: isTarget && ['ouverte'].includes(r.status),
    canClose: (isSender || onProject || isTarget || me.admin) && r.status !== 'close',
    canReopen: (isSender || isTarget) && r.status === 'close',
  };
}

async function loadRequest(db, id) {
  return one(db, `SELECT r.*, pe.name AS from_name, fp.label AS from_post_label, fu.code AS from_unit, tp.label AS to_post_label, tu.code AS to_unit, tu.name AS to_unit_name,
      pr.title AS project_title, pr.code AS project_code, pr.starts_at AS project_date, pr.status AS project_status, ab.name AS answered_by_name
    FROM requests r JOIN people pe ON pe.id = r.from_person_id LEFT JOIN posts fp ON fp.id = r.from_post_id LEFT JOIN units fu ON fu.id = fp.unit_id
    JOIN posts tp ON tp.id = r.to_post_id JOIN units tu ON tu.id = tp.unit_id LEFT JOIN projects pr ON pr.id = r.project_id LEFT JOIN people ab ON ab.id = r.answered_by
    WHERE r.id = ?`, id);
}

async function mailAbout(env, c, db, r, recipients, { title, intro, quote }) {
  const url = `${siteUrl(env, c)}/#/demande/${r.id}`;
  const rows = [['De', esc(`${r.from_name}${r.from_post_label ? `, ${r.from_post_label}` : ''}`)], ['À', esc(`${r.to_post_label} (${r.to_unit})`)], ['Type', esc(REQUEST_KINDS[r.kind] || r.kind)],
    ...(r.project_title ? [['Projet', esc(r.project_title)]] : [])];
  const msgs = recipients.filter((x, i, a) => x.email && a.findIndex((y) => y.email === x.email) === i).map((x) => ({
    to: x.email, name: x.name, kind: 'demande', ref: String(r.id), subject: `${title} : ${r.subject}`,
    html: layout({ title, intro, rows, button: { label: 'Ouvrir la demande', url }, after: quote ? `<div style="background:#f5f6fa;border-left:4px solid #2d2f84;padding:10px 14px;border-radius:6px">${esc(quote).replace(/\n/g, '<br>')}</div>` : '' }),
  }));
  if (msgs.length) later(c, sendMails(env, db, msgs));
}

// Les personnes « de l'autre côté » d'un message
async function otherSide(db, r, side, meId) {
  if (side === 'target') {
    const sender = await one(db, 'SELECT name, email FROM people WHERE id = ?', r.from_person_id);
    return [sender].filter((x) => x && x.email);
  }
  return (await holdersOf(db, [r.to_post_id])).filter((h) => h.id !== meId);
}

export function registerRequests(app) {
  const q = new Hono();
  q.use('/requests', need());
  q.use('/requests/*', need());

  // Postes qu'on peut solliciter : tous les postes actifs, avec qui les tient (sans e-mail)
  q.get('/requests/targets', async (c) => {
    const posts = await all(c.env.DB, 'SELECT p.id, p.label, p.domain, p.unit_id, u.code AS unit_code, u.name AS unit_name, u.sort AS usort FROM posts p JOIN units u ON u.id = p.unit_id WHERE p.active = 1 AND u.active = 1 ORDER BY u.sort, p.sort');
    // tous les titulaires d'un coup (une liste IN de tous les postes dépasserait les 100 paramètres de D1)
    const t = today();
    const holders = await all(c.env.DB, `SELECT DISTINCT x.post_id, p.name FROM (
        SELECT person_id, post_id FROM assignments WHERE (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)
        UNION SELECT person_id, post_id FROM deputies WHERE start_date <= ? AND end_date >= ?
      ) x JOIN people p ON p.id = x.person_id WHERE p.active = 1 ORDER BY p.name`, t, t, t, t);
    return c.json(posts.map((p) => ({ ...p, holders: holders.filter((h) => h.post_id === p.id).map((h) => h.name) })));
  });

  q.get('/requests', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    const box = c.req.query('box') === 'out' ? 'out' : 'in';
    const myPosts = me.posts.map((p) => p.id);
    let where; let args;
    if (box === 'in') {
      if (!myPosts.length) return c.json([]);
      where = `r.to_post_id IN (${myPosts.map(() => '?').join(',')})`; args = myPosts;
    } else {
      where = 'r.from_person_id = ?'; args = [me.person?.id ?? 0];
    }
    const rows = await all(db, `SELECT r.id, r.kind, r.subject, r.status, r.created_at, r.updated_at, r.project_id, pe.name AS from_name, fp.label AS from_post_label, fu.code AS from_unit,
        tp.label AS to_post_label, tu.code AS to_unit, pr.title AS project_title,
        (SELECT COUNT(*) FROM request_messages m WHERE m.request_id = r.id AND m.kind = 'message') AS n_messages
      FROM requests r JOIN people pe ON pe.id = r.from_person_id LEFT JOIN posts fp ON fp.id = r.from_post_id LEFT JOIN units fu ON fu.id = fp.unit_id
      JOIN posts tp ON tp.id = r.to_post_id JOIN units tu ON tu.id = tp.unit_id LEFT JOIN projects pr ON pr.id = r.project_id
      WHERE ${where} ORDER BY (r.status = 'ouverte') DESC, r.updated_at DESC LIMIT 300`, ...args);
    return c.json(rows);
  });

  q.post('/requests', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    if (!me.person) throw httpError(403, 'Connecte-toi avec ton compte personnel pour envoyer une demande.');
    const b = await c.req.json();
    const kind = REQUEST_KINDS[b.kind] ? b.kind : 'info';
    const subject = str(b.subject, 160);
    const body = str(b.body, 4000);
    if (!subject) throw httpError(400, 'Un objet, au moins');
    if (!body) throw httpError(400, 'Écris quelques lignes pour expliquer ta demande');
    const targets = [...new Set((b.to_post_ids || []).map(Number).filter(Boolean))];
    if (!targets.length) throw httpError(400, 'Choisis au moins un responsable à solliciter');
    if (targets.length > MAX_TARGETS) throw httpError(400, `Au plus ${MAX_TARGETS} destinataires par demande`);
    const valid = await all(db, `SELECT id FROM posts WHERE active = 1 AND id IN (${targets.map(() => '?').join(',')})`, ...targets);
    if (valid.length !== targets.length) throw httpError(400, 'Un des postes choisis n\'existe plus');
    let projectId = b.project_id ? Number(b.project_id) : null;
    if (projectId) {
      const p = await one(db, 'SELECT id, owner_id FROM projects WHERE id = ?', projectId);
      const member = p && (p.owner_id === me.person.id || await one(db, 'SELECT 1 AS x FROM project_members WHERE project_id = ? AND person_id = ?', p.id, me.person.id));
      if (!member && !me.admin) throw httpError(403, 'Tu ne peux rattacher une demande qu\'à un de tes projets');
    }
    const fromPost = b.from_post_id && me.posts.some((p) => p.id === Number(b.from_post_id)) ? Number(b.from_post_id) : (me.posts[0]?.id ?? null);
    const ids = [];
    for (const t of targets) {
      const res = await run(db, 'INSERT INTO requests (project_id, from_person_id, from_post_id, to_post_id, kind, subject) VALUES (?,?,?,?,?,?)', projectId, me.person.id, fromPost, t, kind, subject);
      ids.push(res.meta.last_row_id);
    }
    await db.batch(ids.map((rid) => db.prepare('INSERT INTO request_messages (request_id, person_id, kind, body) VALUES (?,?,?,?)').bind(rid, me.person.id, 'message', body)));
    if (projectId) await run(db, 'INSERT INTO events (project_id, person_id, kind, detail) VALUES (?,?,?,?)', projectId, me.person.id, 'sollicitation', JSON.stringify({ to: valid.length, kind }));
    for (const rid of ids) {
      const r = await loadRequest(db, rid);
      const to = await holdersOf(db, [r.to_post_id]);
      await mailAbout(c.env, c, db, r, to, { title: 'Nouvelle demande', intro: `${esc(r.from_name)} te sollicite en tant que <b>${esc(r.to_post_label)}</b>.`, quote: body });
    }
    return c.json({ ids });
  });

  q.get('/requests/:id', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    const r = await loadRequest(db, Number(c.req.param('id')));
    if (!r) throw httpError(404, 'Demande introuvable');
    const acc = await requestAccess(db, me, r);
    if (!acc.canSee) throw httpError(403, 'Cette demande ne te concerne pas');
    const messages = await all(db, 'SELECT m.*, p.name FROM request_messages m LEFT JOIN people p ON p.id = m.person_id WHERE m.request_id = ? ORDER BY m.id', r.id);
    const holders = (await holdersOf(db, [r.to_post_id])).map((h) => h.name);
    return c.json({ request: r, messages, holders, can: acc });
  });

  q.post('/requests/:id/messages', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    const r = await loadRequest(db, Number(c.req.param('id')));
    if (!r) throw httpError(404, 'Demande introuvable');
    const acc = await requestAccess(db, me, r);
    if (!acc.canReply) throw httpError(403, 'Tu ne peux pas répondre à cette demande');
    const body = str((await c.req.json()).body, 4000);
    if (!body) throw httpError(400, 'Message vide');
    await run(db, 'INSERT INTO request_messages (request_id, person_id, kind, body) VALUES (?,?,?,?)', r.id, me.person.id, 'message', body);
    await run(db, "UPDATE requests SET updated_at = datetime('now') WHERE id = ?", r.id);
    await mailAbout(c.env, c, db, r, await otherSide(db, r, acc.side, me.person.id), { title: 'Nouveau message', intro: `${esc(me.person.name)} a répondu sur cette demande.`, quote: body });
    return c.json({ ok: true });
  });

  // Réponse de la personne sollicitée : accepter, « bien noté » (pour une simple information), décliner
  q.post('/requests/:id/answer', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    const r = await loadRequest(db, Number(c.req.param('id')));
    if (!r) throw httpError(404, 'Demande introuvable');
    const acc = await requestAccess(db, me, r);
    if (!acc.canAnswer) throw httpError(403, 'Seule la personne sollicitée répond, une fois');
    const b = await c.req.json();
    const status = ['acceptee', 'vue', 'declinee'].includes(b.status) ? b.status : null;
    if (!status) throw httpError(400, 'Réponse inconnue');
    const body = str(b.body, 2000);
    if (status === 'declinee' && !body) throw httpError(400, 'Dis en une phrase pourquoi tu déclines');
    await run(db, "UPDATE requests SET status = ?, answered_at = datetime('now'), answered_by = ?, updated_at = datetime('now') WHERE id = ?", status, me.person.id, r.id);
    await run(db, 'INSERT INTO request_messages (request_id, person_id, kind, body) VALUES (?,?,?,?)', r.id, me.person.id, status, body);
    if (r.project_id) await run(db, 'INSERT INTO events (project_id, person_id, kind, detail) VALUES (?,?,?,?)', r.project_id, me.person.id, `demande_${status}`, JSON.stringify({ post: r.to_post_label, comment: body }));
    const label = REQUEST_STATUSES[status].label.toLowerCase();
    await mailAbout(c.env, c, db, r, await otherSide(db, r, 'target', me.person.id), { title: `Demande ${label}`, intro: `${esc(me.person.name)} (${esc(r.to_post_label)}) a répondu : <b>${esc(label)}</b>.`, quote: body });
    return c.json({ ok: true, status });
  });

  q.post('/requests/:id/close', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    const r = await loadRequest(db, Number(c.req.param('id')));
    if (!r) throw httpError(404, 'Demande introuvable');
    const acc = await requestAccess(db, me, r);
    if (!acc.canClose && !acc.canReopen) throw httpError(403, 'Action impossible');
    const reopen = acc.canReopen && (await c.req.json().catch(() => ({}))).reopen;
    await run(db, "UPDATE requests SET status = ?, updated_at = datetime('now') WHERE id = ?", reopen ? 'ouverte' : 'close', r.id);
    await run(db, 'INSERT INTO request_messages (request_id, person_id, kind) VALUES (?,?,?)', r.id, me.person?.id ?? null, reopen ? 'reouverte' : 'close');
    return c.json({ ok: true });
  });

  app.route('/', q);
}

// Résumé des demandes d'un projet, pour sa fiche
export async function requestsOfProject(db, projectId) {
  return all(db, `SELECT r.id, r.kind, r.subject, r.status, r.created_at, tp.label AS to_post_label, tu.code AS to_unit, pe.name AS from_name, ab.name AS answered_by_name
    FROM requests r JOIN posts tp ON tp.id = r.to_post_id JOIN units tu ON tu.id = tp.unit_id JOIN people pe ON pe.id = r.from_person_id LEFT JOIN people ab ON ab.id = r.answered_by
    WHERE r.project_id = ? ORDER BY r.id`, projectId).catch(() => []);
}

export async function inboxCount(db, me) {
  const ids = me.posts.map((p) => p.id);
  if (!ids.length) return 0;
  const r = await one(db, `SELECT COUNT(*) AS n FROM requests WHERE status = 'ouverte' AND to_post_id IN (${ids.map(() => '?').join(',')})`, ...ids).catch(() => null);
  return r?.n || 0;
}
