// Projets : fiche, dépôt, circuit de validation, escalade, calendrier, tableau de bord, exports.
import { Hono } from 'hono';
import {
  computeLevel, stepsForLevel, delayDays, exerciseFor, projectCode, missingFields, sumLines, STATUSES, STEP_LABELS, TYPES, DOMAINS, money, APP_NAME, LEVEL_LABELS,
} from '../public/js/shared.js';
import { all, one, run, httpError, today, now, str, bool, getRules, holdersOf, need, csvCell } from './util.js';
import { sendMails, layout, esc, longDate, siteUrl, later } from './mail.js';

const FIELDS = ['title', 'type', 'unit_id', 'domain', 'owner_post_id', 'starts_at', 'ends_at', 'start_time', 'location', 'location_kind', 'audience', 'expected', 'summary', 'objective',
  'needs_room', 'needs_material', 'needs_com', 'external_speaker', 'external_com', 'partner', 'national', 'details', 'risks', 'plan_com', 'plan_logi', 'public_link'];
const INTS = ['unit_id', 'owner_post_id', 'expected'];
const BOOLS = ['needs_room', 'needs_material', 'needs_com', 'external_speaker', 'external_com', 'partner', 'national', 'public_link'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function clean(b, prev = {}) {
  const p = { ...prev };
  for (const f of FIELDS) {
    if (b[f] === undefined) continue;
    if (INTS.includes(f)) p[f] = b[f] === null || b[f] === '' ? null : Number(b[f]) || null;
    else if (BOOLS.includes(f)) p[f] = bool(b[f]);
    else if (['starts_at', 'ends_at', 'plan_com', 'plan_logi'].includes(f)) p[f] = DATE.test(b[f] || '') ? b[f] : null;
    else p[f] = str(b[f], f === 'title' ? 140 : 4000);
  }
  for (const f of FIELDS) if (p[f] === undefined) p[f] = BOOLS.includes(f) ? 0 : null;
  if (!TYPES[p.type]) p.type = 'autre';
  if (!['fac', 'hors_fac', 'ligne'].includes(p.location_kind)) p.location_kind = 'fac';
  if (p.domain && !DOMAINS[p.domain]) p.domain = null;
  if (p.ends_at && p.starts_at && p.ends_at < p.starts_at) p.ends_at = p.starts_at;
  return p;
}
function cleanLines(lines) {
  return (Array.isArray(lines) ? lines : []).slice(0, 60).map((l, i) => ({
    kind: l.kind === 'recette' ? 'recette' : 'depense', label: str(l.label, 160) || '', amount: Math.max(0, Math.round((Number(l.amount) || 0) * 100) / 100),
    payment: ['carte', 'remboursement', 'virement', 'gratuit'].includes(l.payment) ? l.payment : null, sort: i,
  })).filter((l) => l.label || l.amount);
}

const event = (db, projectId, personId, kind, detail) => run(db, 'INSERT INTO events (project_id, person_id, kind, detail) VALUES (?,?,?,?)', projectId, personId ?? null, kind, detail ? JSON.stringify(detail) : null);

// Ce qu'une personne peut faire sur un projet
async function access(db, me, p) {
  const myPosts = me.posts.map((x) => x.id);
  const isOwner = !!me.person && p.owner_id === me.person.id;
  const isMember = !!me.person && !!(await one(db, 'SELECT 1 AS x FROM project_members WHERE project_id = ? AND person_id = ?', p.id, me.person.id));
  const approvals = await all(db, 'SELECT * FROM approvals WHERE project_id = ?', p.id);
  const inChain = approvals.some((a) => myPosts.includes(a.post_id));
  const ownerPost = p.owner_post_id ? await one(db, 'SELECT * FROM posts WHERE id = ?', p.owner_post_id) : null;
  const functional = !!ownerPost?.functional_id && myPosts.includes(ownerPost.functional_id);
  // chefs d'une structure : voient tout ce qui s'y passe
  const headOfUnit = me.posts.some((x) => x.is_head && (x.unit_id === p.unit_id || x.unit_kind === 'localite'));
  const isPublicStatus = ['valide', 'realise', 'cloture'].includes(p.status);
  const canSee = me.admin || isOwner || isMember || inChain || functional || headOfUnit || me.flags.isBureau || me.flags.isTreasurer || isPublicStatus;
  const editable = ['brouillon', 'complement', 'ajourne'].includes(p.status);
  const pending = approvals.filter((a) => a.decision === 'pending' && (me.admin || myPosts.includes(a.post_id)));
  return {
    canSee, isOwner, isMember, approvals,
    canEdit: (isOwner || isMember || me.admin) && editable,
    canEditValidated: me.admin && ['valide', 'realise'].includes(p.status),
    canSubmit: (isOwner || isMember || me.admin) && editable,
    canDecide: pending.filter((a) => !(isOwner && !me.admin)).map((a) => a.id),
    canAbandon: (isOwner || me.admin) && ['depose', 'complement', 'valide', 'ajourne', 'brouillon'].includes(p.status),
    canRealize: (isOwner || isMember || me.admin) && p.status === 'valide',
    canClose: (me.admin || me.flags.isTreasurer || inChain || headOfUnit) && !isOwner && ['realise', 'valide'].includes(p.status),
    canComment: canSee && !!me.person,
  };
}

// Le N+1 d'un poste : son parent, en sautant les postes tenus par le porteur lui-même ; faute de parent, un membre du bureau de la structure parente
async function n1Post(db, ownerPostId, ownerId) {
  let post = ownerPostId ? await one(db, 'SELECT * FROM posts WHERE id = ?', ownerPostId) : null;
  const ownPosts = new Set((await all(db, 'SELECT post_id FROM assignments WHERE person_id = ?', ownerId)).map((r) => r.post_id));
  let guard = 0;
  while (post && ++guard < 10) {
    const parent = post.parent_id ? await one(db, 'SELECT * FROM posts WHERE id = ? AND active = 1', post.parent_id) : null;
    if (!parent) break;
    // un poste vacant ne peut pas valider : on passe au niveau au-dessus, comme si le délai était déjà écoulé
    const vacant = !(await holdersOf(db, [parent.id])).length;
    if (!ownPosts.has(parent.id) && !vacant) return parent;
    post = parent;
  }
  // tête de la localité (manager) ou poste sans parent : le vice-manager étudiants ou un autre membre du bureau valide
  const unitId = post?.unit_id;
  const bureau = await all(db, 'SELECT * FROM posts WHERE is_bureau = 1 AND active = 1 AND unit_id = (SELECT COALESCE(parent_id, id) FROM units WHERE id = ?) ORDER BY (code = \'vm_etudiants\') DESC, sort', unitId ?? 0);
  return bureau.find((b) => !ownPosts.has(b.id)) || null;
}

async function loadLines(db, id) { return all(db, 'SELECT * FROM budget_lines WHERE project_id = ? ORDER BY sort', id); }

async function fullProject(db, me, id) {
  const p = await one(db, `SELECT p.*, u.code AS unit_code, u.name AS unit_name, o.name AS owner_name, op.label AS owner_post_label FROM projects p JOIN units u ON u.id = p.unit_id
    JOIN people o ON o.id = p.owner_id LEFT JOIN posts op ON op.id = p.owner_post_id WHERE p.id = ?`, id);
  if (!p) throw httpError(404, 'Projet introuvable');
  const acc = await access(db, me, p);
  if (!acc.canSee) throw httpError(403, 'Tu n\'as pas accès à ce projet');
  const lines = await loadLines(db, id);
  const approvals = await all(db, `SELECT a.*, ps.label AS post_label, u.code AS post_unit, d.name AS decider_name FROM approvals a LEFT JOIN posts ps ON ps.id = a.post_id LEFT JOIN units u ON u.id = ps.unit_id
    LEFT JOIN people d ON d.id = a.person_id WHERE a.project_id = ? ORDER BY a.round, a.id`, id);
  const holders = await holdersOf(db, [...new Set(approvals.map((a) => a.post_id).filter(Boolean))]);
  for (const a of approvals) a.holders = holders.filter((h) => h.post_id === a.post_id).map((h) => h.name);
  const events = await all(db, 'SELECT e.*, pe.name FROM events e LEFT JOIN people pe ON pe.id = e.person_id WHERE e.project_id = ? ORDER BY e.id', id);
  const members = await all(db, 'SELECT pe.id, pe.name FROM project_members m JOIN people pe ON pe.id = m.person_id WHERE m.project_id = ?', id);
  const rules = await getRules(db);
  const { approvals: _a, ...can } = acc;
  return { project: p, lines, approvals, events, members, can, rules, spend: sumLines(lines, 'depense'), income: sumLines(lines, 'recette') };
}

async function saveLines(db, id, lines) {
  await run(db, 'DELETE FROM budget_lines WHERE project_id = ?', id);
  if (!lines.length) return;
  const per = 16; // 6 colonnes, moins de 100 paramètres
  const stmts = [];
  for (let i = 0; i < lines.length; i += per) {
    const chunk = lines.slice(i, i + per);
    stmts.push(db.prepare(`INSERT INTO budget_lines (project_id, kind, label, amount, payment, sort) VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(',')}`)
      .bind(...chunk.flatMap((l) => [id, l.kind, l.label, l.amount, l.payment, l.sort])));
  }
  await db.batch(stmts);
}

async function saveMembers(db, id, ids) {
  await run(db, 'DELETE FROM project_members WHERE project_id = ?', id);
  const clean = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 20);
  if (clean.length) await run(db, `INSERT OR IGNORE INTO project_members (project_id, person_id) VALUES ${clean.map(() => '(?,?)').join(',')}`, ...clean.flatMap((x) => [id, x]));
}

// ---------- e-mails ----------
function projectRows(p, spend) {
  return [['Projet', esc(p.title)], ['Structure', esc(p.unit_name)], ['Date', esc(longDate(p.starts_at))], ['Porteur', esc(p.owner_name)], ...(spend ? [['Budget demandé', esc(money(spend))]] : [])];
}
async function notify(env, db, c, kind, p, recipients, { title, intro, after = '' }) {
  const spend = sumLines(await loadLines(db, p.id), 'depense');
  const url = `${siteUrl(env, c)}/#/projet/${p.id}`;
  const msgs = recipients.filter((r, i, arr) => r.email && arr.findIndex((x) => x.email === r.email) === i).map((r) => ({
    to: r.email, name: r.name, kind, ref: String(p.id), subject: `${title} : ${p.title}`,
    html: layout({ title, intro, rows: projectRows(p, spend), button: { label: 'Ouvrir le projet', url }, after }),
  }));
  if (!msgs.length) return;
  const task = sendMails(env, db, msgs);
  if (c) later(c, task); else await task;
}

// ---------- dépôt et circuit ----------
async function buildApprovals(db, p, level, rules, round) {
  const steps = stepsForLevel(level);
  const due = new Date(Date.now() + delayDays(level, rules) * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const rows = [];
  const n1 = await n1Post(db, p.owner_post_id, p.owner_id);
  if (!n1) throw httpError(400, 'Aucun responsable hiérarchique n\'est défini pour ton poste : demande au secrétaire de corriger l\'organigramme.');
  rows.push(['n1', n1.id]);
  const localite = await one(db, 'SELECT COALESCE(parent_id, id) AS id FROM units WHERE id = ?', p.unit_id);
  if (steps.includes('tresorier')) {
    const t = await one(db, 'SELECT id FROM posts WHERE is_treasurer = 1 AND active = 1 AND unit_id = ? ORDER BY sort LIMIT 1', localite.id);
    if (!t) throw httpError(400, 'Aucun trésorier n\'est défini dans l\'organigramme.');
    if (t.id !== n1.id) rows.push(['tresorier', t.id]);
  }
  if (steps.includes('bureau')) {
    const bureau = await all(db, 'SELECT id FROM posts WHERE is_bureau = 1 AND active = 1 AND unit_id = ? ORDER BY sort', localite.id);
    // un poste déjà sollicité comme N+1 ou trésorier ne vote pas une seconde fois au titre du bureau
    for (const b of bureau) if (!rows.some(([, id]) => id === b.id)) rows.push(['bureau', b.id]);
  }
  await run(db, `INSERT INTO approvals (project_id, step, post_id, due_at, round) VALUES ${rows.map(() => '(?,?,?,?,?)').join(',')}`, ...rows.flatMap(([s, id]) => [p.id, s, id, due, round]));
  return { due, posts: rows.map((r) => r[1]) };
}

// Après chaque décision : le projet est-il validé, refusé, ajourné ?
async function settle(db, env, c, p, rules) {
  const approvals = await all(db, 'SELECT * FROM approvals WHERE project_id = ? AND round = (SELECT MAX(round) FROM approvals WHERE project_id = ?)', p.id, p.id);
  const by = (step) => approvals.filter((a) => a.step === step);
  const refused = approvals.find((a) => a.decision === 'refuse');
  const postponed = approvals.find((a) => a.decision === 'ajourne');
  const complement = approvals.find((a) => a.decision === 'complement');
  let status = null; let note = null;
  if (refused) { status = 'refuse'; note = refused.comment; }
  else if (complement) { status = 'complement'; note = complement.comment; }
  else if (postponed) { status = 'ajourne'; note = postponed.comment; }
  else {
    const steps = stepsForLevel(p.level);
    const okN1 = by('n1').some((a) => a.decision === 'ok');
    const okT = !steps.includes('tresorier') || !by('tresorier').length || by('tresorier').some((a) => a.decision === 'ok');
    const okB = !steps.includes('bureau') || by('bureau').filter((a) => a.decision === 'ok').length >= Math.min(rules.quorum, by('bureau').length);
    if (okN1 && okT && okB) status = 'valide';
  }
  if (!status) return null;
  if (status === 'valide') {
    const seq = (await one(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM projects WHERE exercise = ?', p.exercise)).n;
    const unit = await one(db, 'SELECT code FROM units WHERE id = ?', p.unit_id);
    const code = projectCode(p.exercise, unit.code, p.domain, seq);
    await run(db, "UPDATE projects SET status = 'valide', seq = ?, code = ?, validated_at = datetime('now'), decided_at = datetime('now'), updated_at = datetime('now'), decision_note = NULL WHERE id = ?", seq, code, p.id);
    // les demandes encore en attente du même tour sont closes
    await run(db, "UPDATE approvals SET decision = 'void' WHERE project_id = ? AND decision = 'pending'", p.id);
    await event(db, p.id, null, 'valide', { code });
    const full = await one(db, 'SELECT p.*, u.name AS unit_name, o.name AS owner_name, o.email AS owner_email FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id WHERE p.id = ?', p.id);
    const ownerPost = p.owner_post_id ? await one(db, 'SELECT functional_id FROM posts WHERE id = ?', p.owner_post_id) : null;
    const info = ownerPost?.functional_id ? await holdersOf(db, [ownerPost.functional_id]) : [];
    const members = await all(db, 'SELECT pe.name, pe.email FROM project_members m JOIN people pe ON pe.id = m.person_id WHERE m.project_id = ?', p.id);
    await notify(env, db, c, 'valide', full, [{ name: full.owner_name, email: full.owner_email }, ...members, ...info], {
      title: 'Projet validé', intro: `Feu vert. Le projet porte le code <b>${esc(code)}</b> : il doit figurer sur chaque dépense, chaque note de frais et chaque support de communication.`,
      after: 'Prochaines étapes : confirmer la logistique, lancer la communication, puis déposer le bilan dans les 15 jours après la date du projet.',
    });
  } else {
    await run(db, "UPDATE projects SET status = ?, decided_at = datetime('now'), updated_at = datetime('now'), decision_note = ?, postponed_to = ? WHERE id = ?", status, note, postponed?.postponed_to ?? null, p.id);
    await run(db, "UPDATE approvals SET decision = 'void' WHERE project_id = ? AND decision = 'pending'", p.id);
    const full = await one(db, 'SELECT p.*, u.name AS unit_name, o.name AS owner_name, o.email AS owner_email FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id WHERE p.id = ?', p.id);
    const titles = { refuse: 'Projet refusé', complement: 'Complément demandé', ajourne: 'Projet ajourné' };
    const intros = {
      refuse: `Le projet n'a pas été retenu. Motif : ${esc(note || 'non précisé')}.`,
      complement: `Le valideur a besoin de précisions avant de se prononcer : ${esc(note || 'voir la fiche')}. Complète la fiche puis dépose-la de nouveau.`,
      ajourne: `La décision est reportée${postponed?.postponed_to ? ` au ${esc(longDate(postponed.postponed_to))}` : ''}. ${esc(note || '')}`,
    };
    await notify(env, db, c, status, full, [{ name: full.owner_name, email: full.owner_email }], { title: titles[status], intro: intros[status] });
  }
  return status;
}

export function registerProjects(app) {
  const r = new Hono();
  r.use('*', need());

  // Liste. scope : mine (porteur ou co-porteur), validate (à décider par moi), team (mes subordonnés et mes structures), all (bureau, trésorier, admin)
  r.get('/projects', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    const q = c.req.query();
    const scope = q.scope || 'mine';
    const where = []; const args = [];
    if (scope === 'mine') { where.push('(p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE person_id = ?))'); args.push(me.person?.id ?? 0, me.person?.id ?? 0); }
    else if (scope === 'validate') {
      const ids = me.posts.map((x) => x.id);
      if (me.admin) where.push("p.status = 'depose'");
      else if (!ids.length) where.push('0');
      else { where.push(`p.id IN (SELECT project_id FROM approvals WHERE decision = 'pending' AND post_id IN (${ids.map(() => '?').join(',')})) AND p.owner_id != ?`); args.push(...ids, me.person?.id ?? 0); }
    } else if (scope === 'team') {
      if (me.admin || me.flags.isBureau || me.flags.isTreasurer) { /* tout */ } else {
        const heads = me.posts.filter((x) => x.is_head).map((x) => x.unit_id);
        const ids = me.posts.map((x) => x.id);
        const parts = [];
        if (heads.length) { parts.push(`p.unit_id IN (${heads.map(() => '?').join(',')})`); args.push(...heads); }
        if (ids.length) {
          parts.push(`p.owner_post_id IN (SELECT id FROM posts WHERE parent_id IN (${ids.map(() => '?').join(',')}) OR functional_id IN (${ids.map(() => '?').join(',')}))`); args.push(...ids, ...ids);
          parts.push(`p.id IN (SELECT project_id FROM approvals WHERE post_id IN (${ids.map(() => '?').join(',')}))`); args.push(...ids);
        }
        where.push(parts.length ? `(${parts.join(' OR ')})` : '0');
      }
    } else if (scope === 'all') {
      if (!(me.admin || me.flags.isBureau || me.flags.isTreasurer)) where.push("p.status IN ('valide','realise','cloture')");
    }
    if (q.status) { const st = q.status.split(',').filter((s) => STATUSES[s]); if (st.length) { where.push(`p.status IN (${st.map(() => '?').join(',')})`); args.push(...st); } }
    if (q.unit) { where.push('p.unit_id = ?'); args.push(Number(q.unit)); }
    if (q.exercise) { where.push('p.exercise = ?'); args.push(q.exercise); }
    if (q.from) { where.push('p.starts_at >= ?'); args.push(q.from); }
    if (q.to) { where.push('p.starts_at <= ?'); args.push(q.to); }
    const rows = await all(db, `SELECT p.id, p.code, p.title, p.type, p.status, p.level, p.starts_at, p.start_time, p.location, p.unit_id, p.domain, p.owner_id, p.due_at, p.submitted_at, p.updated_at, p.expected,
        u.code AS unit_code, o.name AS owner_name,
        (SELECT COALESCE(SUM(amount), 0) FROM budget_lines b WHERE b.project_id = p.id AND b.kind = 'depense') AS spend,
        (SELECT COUNT(*) FROM approvals a WHERE a.project_id = p.id AND a.decision = 'pending') AS pending
      FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.starts_at DESC, p.id DESC LIMIT 500`, ...args);
    return c.json(rows);
  });

  r.post('/projects', async (c) => {
    const me = c.get('me'); const db = c.env.DB;
    if (!me.person) throw httpError(403, 'Le compte technique ne porte pas de projet : connecte-toi avec ton compte personnel.');
    const b = await c.req.json();
    const p = clean(b);
    if (!p.title) throw httpError(400, 'Un titre, au moins');
    const post = p.owner_post_id ? me.posts.find((x) => x.id === p.owner_post_id) : me.posts[0];
    if (!post && !me.admin) throw httpError(403, 'Tu n\'as pas encore de poste dans l\'organigramme : demande au secrétaire de t\'y rattacher.');
    p.owner_post_id = post?.id ?? null;
    p.unit_id = p.unit_id || post?.unit_id;
    if (!p.unit_id) throw httpError(400, 'Structure porteuse requise');
    if (!p.domain && post?.domain) p.domain = post.domain;
    const exercise = exerciseFor(p.starts_at || today());
    const res = await run(db, `INSERT INTO projects (exercise, title, type, unit_id, domain, owner_id, owner_post_id, starts_at, ends_at, start_time, location, location_kind, audience, expected, summary, objective,
      needs_room, needs_material, needs_com, external_speaker, external_com, partner, national, details, risks, plan_com, plan_logi, public_link) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    exercise, p.title, p.type, p.unit_id, p.domain, me.person.id, p.owner_post_id, p.starts_at, p.ends_at, p.start_time, p.location, p.location_kind, p.audience, p.expected, p.summary, p.objective,
    p.needs_room ?? 0, p.needs_material ?? 0, p.needs_com ?? 0, p.external_speaker ?? 0, p.external_com ?? 0, p.partner ?? 0, p.national ?? 0, p.details, p.risks, p.plan_com, p.plan_logi, p.public_link ?? 0);
    const id = res.meta.last_row_id;
    await saveLines(db, id, cleanLines(b.lines));
    await saveMembers(db, id, b.members);
    await event(db, id, me.person.id, 'cree');
    return c.json({ id });
  });

  r.get('/projects/:id', async (c) => c.json(await fullProject(c.env.DB, c.get('me'), Number(c.req.param('id')))));

  r.put('/projects/:id', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const id = Number(c.req.param('id'));
    const f = await fullProject(db, me, id);
    if (!f.can.canEdit && !f.can.canEditValidated) throw httpError(403, 'Ce projet ne peut plus être modifié à ce stade');
    const b = await c.req.json();
    const p = clean(b, f.project);
    if (b.owner_post_id !== undefined && !me.admin && !me.posts.some((x) => x.id === p.owner_post_id)) p.owner_post_id = f.project.owner_post_id;
    const exercise = exerciseFor(p.starts_at || today());
    await run(db, `UPDATE projects SET title = ?, type = ?, unit_id = ?, domain = ?, owner_post_id = ?, starts_at = ?, ends_at = ?, start_time = ?, location = ?, location_kind = ?, audience = ?, expected = ?, summary = ?, objective = ?,
      needs_room = ?, needs_material = ?, needs_com = ?, external_speaker = ?, external_com = ?, partner = ?, national = ?, details = ?, risks = ?, plan_com = ?, plan_logi = ?, public_link = ?, exercise = CASE WHEN code IS NULL THEN ? ELSE exercise END, updated_at = datetime('now') WHERE id = ?`,
    p.title, p.type, p.unit_id, p.domain, p.owner_post_id, p.starts_at, p.ends_at, p.start_time, p.location, p.location_kind, p.audience, p.expected, p.summary, p.objective,
    p.needs_room, p.needs_material, p.needs_com, p.external_speaker, p.external_com, p.partner, p.national, p.details, p.risks, p.plan_com, p.plan_logi, p.public_link, exercise, id);
    if (b.lines !== undefined) await saveLines(db, id, cleanLines(b.lines));
    if (b.members !== undefined) await saveMembers(db, id, b.members);
    if (f.can.canEditValidated) await event(db, id, me.person?.id, 'modifie_admin');
    return c.json({ ok: true });
  });

  // Dépôt : calcul du niveau, contrôle des champs, création du circuit
  r.post('/projects/:id/submit', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const id = Number(c.req.param('id'));
    const f = await fullProject(db, me, id);
    if (!f.can.canSubmit) throw httpError(403, 'Dépôt impossible à ce stade');
    const level = computeLevel(f.project, f.lines, f.rules);
    const miss = missingFields(f.project, f.lines, level);
    if (miss.length) throw httpError(400, `Il manque ${miss.join(', ')}.`);
    if (f.project.starts_at < today() && !me.admin) throw httpError(400, 'La date est passée : un projet se déclare avant d\'avoir lieu. Si c\'est une régularisation, demande à l\'admin.');
    if (level >= 1 && !me.admin) {
      const lateB = await one(db, "SELECT COUNT(*) AS n FROM projects WHERE owner_id = ? AND id != ? AND status IN ('valide','realise') AND starts_at < date('now', '-15 days')", f.project.owner_id, id);
      if (lateB.n) throw httpError(400, `${lateB.n} projet(s) passé(s) attendent encore leur clôture : règle-les avant de demander un nouveau budget.`);
    }
    const round = ((await one(db, 'SELECT COALESCE(MAX(round), 0) AS r FROM approvals WHERE project_id = ?', id)).r) + 1;
    const p = { ...f.project, level };
    const { due, posts } = await buildApprovals(db, p, level, f.rules, round);
    await run(db, "UPDATE projects SET status = 'depose', level = ?, submitted_at = datetime('now'), due_at = ?, decision_note = NULL, postponed_to = NULL, updated_at = datetime('now') WHERE id = ?", level, due, id);
    await event(db, id, me.person?.id, 'depose', { level, round });
    const validators = await holdersOf(db, posts);
    const delay = delayDays(level, f.rules);
    await notify(c.env, db, c, 'depose', f.project, validators, {
      title: 'Projet à valider', intro: `${esc(f.project.owner_name)} dépose un projet de niveau ${level} (${esc(LEVEL_LABELS[level])}). Tu as <b>${delay} jours</b> pour te prononcer ; passé ce délai, la demande remonte automatiquement d'un cran. Le silence ne vaut pas accord.`,
    });
    return c.json({ ok: true, level, due });
  });

  // Décision d'un valideur
  r.post('/projects/:id/decide', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const id = Number(c.req.param('id'));
    const f = await fullProject(db, me, id);
    const b = await c.req.json();
    const decision = ['ok', 'refuse', 'ajourne', 'complement'].includes(b.decision) ? b.decision : null;
    if (!decision) throw httpError(400, 'Décision inconnue');
    if (!f.can.canDecide.length) throw httpError(403, 'Tu n\'as pas de décision en attente sur ce projet');
    if (f.project.status !== 'depose') throw httpError(400, 'Ce projet n\'est pas en instruction');
    const comment = str(b.comment, 1000);
    if (decision !== 'ok' && !comment) throw httpError(400, 'Un motif en une phrase est obligatoire pour refuser, ajourner ou demander un complément');
    const ids = b.approval_id ? f.can.canDecide.filter((x) => x === Number(b.approval_id)) : f.can.canDecide;
    if (!ids.length) throw httpError(403, 'Décision non autorisée');
    const postponed = decision === 'ajourne' && DATE.test(b.postponed_to || '') ? b.postponed_to : null;
    await run(db, `UPDATE approvals SET decision = ?, comment = ?, person_id = ?, decided_at = datetime('now'), postponed_to = ? WHERE id IN (${ids.map(() => '?').join(',')})`, decision, comment, me.person?.id ?? null, postponed, ...ids);
    await event(db, id, me.person?.id, `decision_${decision}`, { comment, approval_ids: ids });
    const pseudo = { ...f.project, postponed_to: postponed };
    const settled = await settle(db, c.env, c, pseudo, f.rules);
    if (settled === 'ajourne' && postponed) await run(db, 'UPDATE projects SET postponed_to = ? WHERE id = ?', postponed, id);
    return c.json({ ok: true, status: settled || 'depose' });
  });

  r.post('/projects/:id/abandon', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const id = Number(c.req.param('id'));
    const f = await fullProject(db, me, id);
    if (!f.can.canAbandon) throw httpError(403, 'Action impossible');
    const { comment } = await c.req.json();
    await run(db, "UPDATE projects SET status = 'abandonne', decision_note = ?, updated_at = datetime('now') WHERE id = ?", str(comment, 500), id);
    await run(db, "UPDATE approvals SET decision = 'void' WHERE project_id = ? AND decision = 'pending'", id);
    await event(db, id, me.person?.id, 'abandonne', { comment: str(comment, 500) });
    return c.json({ ok: true });
  });

  r.post('/projects/:id/realize', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const id = Number(c.req.param('id'));
    const f = await fullProject(db, me, id);
    if (!f.can.canRealize) throw httpError(403, 'Action impossible');
    await run(db, "UPDATE projects SET status = 'realise', done_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", id);
    await event(db, id, me.person?.id, 'realise');
    return c.json({ ok: true });
  });

  r.post('/projects/:id/close', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const id = Number(c.req.param('id'));
    const f = await fullProject(db, me, id);
    if (!f.can.canClose) throw httpError(403, 'Seuls le responsable hiérarchique, le trésorier ou l\'admin clôturent');
    const { comment } = await c.req.json().catch(() => ({}));
    await run(db, "UPDATE projects SET status = 'cloture', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", id);
    await event(db, id, me.person?.id, 'cloture', { comment: str(comment, 500) });
    return c.json({ ok: true });
  });

  r.post('/projects/:id/comments', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const id = Number(c.req.param('id'));
    const f = await fullProject(db, me, id);
    if (!f.can.canComment) throw httpError(403, 'Action impossible');
    const body = str((await c.req.json()).body, 2000);
    if (!body) throw httpError(400, 'Message vide');
    await event(db, id, me.person.id, 'commentaire', { body });
    return c.json({ ok: true });
  });

  // Calendrier : projets validés de la localité, plus ceux que je peux voir en instruction
  r.get('/calendar', async (c) => {
    const me = c.get('me'); const db = c.env.DB; const q = c.req.query();
    const from = DATE.test(q.from || '') ? q.from : today();
    const to = DATE.test(q.to || '') ? q.to : new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
    const rows = await all(db, `SELECT p.id, p.code, p.title, p.type, p.status, p.starts_at, p.ends_at, p.start_time, p.location, p.location_kind, p.unit_id, p.domain, p.owner_id, p.expected, u.code AS unit_code, o.name AS owner_name
      FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id WHERE p.starts_at BETWEEN ? AND ? AND p.status IN ('valide','realise','depose','cloture') ORDER BY p.starts_at, p.start_time`, from, to);
    const wide = me.admin || me.flags.isBureau || me.flags.isTreasurer || me.flags.isHead;
    return c.json(rows.filter((p) => p.status !== 'depose' || wide || p.owner_id === me.person?.id));
  });

  // Tableau de bord du bureau et des responsables
  r.get('/dashboard', need('isValidator'), async (c) => {
    const db = c.env.DB; const me = c.get('me');
    const ex = c.req.query('exercise') || exerciseFor(today());
    const byStatus = await all(db, 'SELECT status, COUNT(*) AS n FROM projects WHERE exercise = ? GROUP BY status', ex);
    const byUnit = await all(db, `SELECT u.id, u.code, u.name, COUNT(p.id) AS n, SUM(CASE WHEN p.status IN ('valide','realise','cloture') THEN 1 ELSE 0 END) AS n_ok,
        COALESCE(SUM(CASE WHEN p.status IN ('valide','realise','cloture') THEN (SELECT SUM(amount) FROM budget_lines b WHERE b.project_id = p.id AND b.kind = 'depense') END), 0) AS engaged,
        COALESCE(SUM(CASE WHEN p.status = 'depose' THEN (SELECT SUM(amount) FROM budget_lines b WHERE b.project_id = p.id AND b.kind = 'depense') END), 0) AS requested
      FROM units u LEFT JOIN projects p ON p.unit_id = u.id AND p.exercise = ? WHERE u.active = 1 GROUP BY u.id ORDER BY u.sort`, ex);
    const byDomain = await all(db, "SELECT COALESCE(domain, 'VIE') AS domain, COUNT(*) AS n FROM projects WHERE exercise = ? AND status IN ('valide','realise','cloture') GROUP BY domain ORDER BY n DESC", ex);
    const pending = await all(db, `SELECT p.id, p.title, p.level, p.due_at, p.submitted_at, u.code AS unit_code, o.name AS owner_name,
        (SELECT GROUP_CONCAT(ps.label, ' · ') FROM approvals a JOIN posts ps ON ps.id = a.post_id WHERE a.project_id = p.id AND a.decision = 'pending') AS waiting_on
      FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id WHERE p.status = 'depose' ORDER BY p.due_at`);
    const late = await all(db, `SELECT p.id, p.title, p.starts_at, p.status, u.code AS unit_code, o.name AS owner_name FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id
      WHERE p.status IN ('valide','realise') AND p.starts_at < date('now', '-15 days') ORDER BY p.starts_at LIMIT 100`);
    const activity = await all(db, "SELECT substr(starts_at, 1, 7) AS month, COUNT(*) AS n FROM projects WHERE exercise = ? AND status IN ('valide','realise','cloture') GROUP BY month ORDER BY month", ex);
    return c.json({ exercise: ex, byStatus, byUnit, byDomain, pending, late, activity, me: { isTreasurer: me.flags.isTreasurer } });
  });

  r.get('/export/projets.csv', need('isValidator'), async (c) => {
    const rows = await all(c.env.DB, `SELECT p.code, p.exercise, p.status, p.level, p.title, p.type, u.code AS unit_code, p.domain, o.name AS owner_name, p.starts_at, p.start_time, p.location, p.location_kind, p.audience, p.expected,
        (SELECT COALESCE(SUM(amount), 0) FROM budget_lines b WHERE b.project_id = p.id AND b.kind = 'depense') AS spend,
        (SELECT COALESCE(SUM(amount), 0) FROM budget_lines b WHERE b.project_id = p.id AND b.kind = 'recette') AS income,
        p.submitted_at, p.validated_at, p.done_at, p.closed_at FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id ORDER BY p.id`);
    const head = ['code', 'exercice', 'statut', 'niveau', 'titre', 'type', 'structure', 'pole_filiere', 'porteur', 'date', 'heure', 'lieu', 'type_lieu', 'public', 'participants_prevus', 'depenses_prevues', 'recettes_prevues', 'depose_le', 'valide_le', 'realise_le', 'cloture_le'];
    const csv = '﻿' + [head, ...rows.map((r) => [r.code, r.exercise, STATUSES[r.status]?.label || r.status, r.level, r.title, TYPES[r.type] || r.type, r.unit_code, r.domain, r.owner_name, r.starts_at, r.start_time, r.location, r.location_kind, r.audience, r.expected, r.spend, r.income, r.submitted_at, r.validated_at, r.done_at, r.closed_at])]
      .map((row) => row.map(csvCell).join(';')).join('\r\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="projets-${APP_NAME.toLowerCase()}-${today()}.csv"` } });
  });

  app.route('/', r);
}

// ---------- tâche quotidienne : escalade et rappels ----------
export async function runDaily(env, c) {
  const db = env.DB;
  const rules = await getRules(db);
  const out = { escalated: 0, reminded: 0, lateBilans: 0 };
  const nowS = now();
  // 1. Demandes en retard : remontée au N+2
  const late = await all(db, `SELECT a.*, p.title, p.level, p.owner_id FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.decision = 'pending' AND a.escalated = 0 AND a.due_at < ? AND p.status = 'depose' AND a.step IN ('n1','tresorier')`, nowS);
  for (const a of late) {
    const post = await one(db, 'SELECT * FROM posts WHERE id = ?', a.post_id);
    const parent = post?.parent_id ? await one(db, 'SELECT * FROM posts WHERE id = ? AND active = 1', post.parent_id) : null;
    await run(db, 'UPDATE approvals SET escalated = 1 WHERE id = ?', a.id);
    if (!parent) continue; // déjà au sommet : rappel seulement
    const due = new Date(Date.now() + delayDays(a.level, rules) * 864e5).toISOString().slice(0, 19).replace('T', ' ');
    await run(db, 'INSERT INTO approvals (project_id, step, post_id, due_at, round, comment) VALUES (?,?,?,?,?,?)', a.project_id, a.step, parent.id, due, a.round, `Escalade automatique : ${post.label} n'a pas répondu dans le délai`);
    await event(db, a.project_id, null, 'escalade', { from: post.label, to: parent.label });
    out.escalated++;
    const full = await one(db, 'SELECT p.*, u.name AS unit_name, o.name AS owner_name FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id WHERE p.id = ?', a.project_id);
    const to = await holdersOf(db, [parent.id, post.id]);
    await notify(env, db, null, 'escalade', full, to, {
      title: 'Demande remontée', intro: `${esc(post.label)} n'a pas répondu dans le délai : la demande remonte à ${esc(parent.label)}, qui doit maintenant se prononcer. Le silence ne vaut pas accord.`,
    });
  }
  // 2. Rappel à J-2 de l'échéance
  const soon = await all(db, `SELECT a.id, a.post_id, a.project_id FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.decision = 'pending' AND p.status = 'depose' AND a.due_at BETWEEN datetime('now', '+1 day') AND datetime('now', '+2 days')`);
  const byProject = new Map();
  for (const a of soon) byProject.set(a.project_id, [...(byProject.get(a.project_id) || []), a.post_id]);
  for (const [pid, postIds] of byProject) {
    const full = await one(db, 'SELECT p.*, u.name AS unit_name, o.name AS owner_name FROM projects p JOIN units u ON u.id = p.unit_id JOIN people o ON o.id = p.owner_id WHERE p.id = ?', pid);
    const to = await holdersOf(db, postIds);
    await notify(env, db, null, 'rappel', full, to, { title: 'Décision attendue sous 48 h', intro: 'Ce projet attend ta décision. Sans réponse à l\'échéance, il remontera automatiquement à ton responsable.' });
    out.reminded += to.length;
  }
  // 3. Projets passés sans bilan : rappel au porteur
  const bilans = await all(db, `SELECT p.id, p.title, p.starts_at, p.unit_id, o.email, o.name AS owner_name, u.name AS unit_name, p.owner_id FROM projects p JOIN people o ON o.id = p.owner_id JOIN units u ON u.id = p.unit_id
    WHERE p.status IN ('valide','realise') AND p.starts_at IN (date('now', '-10 days'), date('now', '-15 days'), date('now', '-30 days'))`);
  for (const p of bilans) {
    await notify(env, db, null, 'bilan', p, [{ name: p.owner_name, email: p.email }], { title: 'Bilan attendu', intro: 'Le projet a eu lieu : marque-le comme réalisé et dépose son bilan (participants, dépenses réelles, ce qu\'il faut retenir). Au-delà de 15 jours, tu ne pourras plus déposer de nouveau projet avec budget.' });
    out.lateBilans++;
  }
  // 4. Ménage
  await run(db, 'DELETE FROM auth_sessions WHERE expires_at < ?', new Date().toISOString());
  await run(db, "DELETE FROM magic_links WHERE expires_at < datetime('now', '-7 days')");
  await run(db, "DELETE FROM login_failures WHERE at < datetime('now', '-1 day')");
  await run(db, 'INSERT INTO cron_log (detail) VALUES (?)', JSON.stringify(out));
  return out;
}
