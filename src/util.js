// Petits utilitaires partagés par les modules du serveur
import { DEFAULT_RULES } from '../public/js/shared.js';

export const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
export const httpError = (status, message) => Object.assign(new Error(message), { status });
export const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
export const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
export const today = () => new Date().toISOString().slice(0, 10);
export const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
// Une cellule qui commence par = + - @ serait exécutée comme formule par le tableur : on la neutralise
export const csvCell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d,.]*$/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
export const str = (v, max = 2000) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
export const bool = (v) => (v ? 1 : 0);

export async function getRules(db) {
  const r = await one(db, "SELECT value FROM settings WHERE key = 'rules'").catch(() => null);
  return { ...DEFAULT_RULES, ...parse(r?.value, {}) };
}

// Postes tenus par une personne aujourd'hui, suppléances comprises
export async function postsOf(db, personId) {
  if (!personId) return [];
  const t = today();
  const rows = await all(db, `SELECT p.*, u.code AS unit_code, u.name AS unit_name, u.kind AS unit_kind, 0 AS deputy FROM assignments a JOIN posts p ON p.id = a.post_id JOIN units u ON u.id = p.unit_id
      WHERE a.person_id = ? AND p.active = 1 AND (a.start_date IS NULL OR a.start_date <= ?) AND (a.end_date IS NULL OR a.end_date >= ?)
    UNION ALL SELECT p.*, u.code, u.name, u.kind, 1 FROM deputies d JOIN posts p ON p.id = d.post_id JOIN units u ON u.id = p.unit_id
      WHERE d.person_id = ? AND p.active = 1 AND d.start_date <= ? AND d.end_date >= ?
    ORDER BY sort`, personId, t, t, personId, t, t);
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
}

// Personnes qui tiennent un poste aujourd'hui (titulaires et suppléants), avec e-mail
export async function holdersOf(db, postIds) {
  if (!postIds.length) return [];
  const t = today();
  const ph = postIds.map(() => '?').join(',');
  return all(db, `SELECT DISTINCT p.id, p.name, p.email, x.post_id FROM (
      SELECT person_id, post_id FROM assignments WHERE post_id IN (${ph}) AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)
      UNION SELECT person_id, post_id FROM deputies WHERE post_id IN (${ph}) AND start_date <= ? AND end_date >= ?
    ) x JOIN people p ON p.id = x.person_id WHERE p.active = 1`, ...postIds, t, t, ...postIds, t, t);
}

export const need = (flag) => async (c, next) => {
  const me = c.get('me');
  if (!me) throw httpError(401, 'Connexion requise');
  if (flag && !me.flags[flag]) throw httpError(403, 'Accès refusé');
  await next();
};
