// Mon espace, projets à valider, projets de mon équipe
import { api, esc, setTitle, statusPill, domainPill, levelPill, money, daysLeft, monthLabel } from './ui.js';
import { state } from './app.js';
import { TYPES } from './shared.js';

const pad = (n) => String(n).padStart(2, '0');
function card(p, { showDue = false } = {}) {
  const d = p.starts_at ? new Date(`${p.starts_at}T12:00:00`) : null;
  const left = showDue && p.due_at ? daysLeft(p.due_at) : null;
  const cls = left !== null ? (left < 0 ? 'late' : left <= 2 ? 'soon' : '') : '';
  return `<a class="pcard ${cls}" href="#/projet/${p.id}">
    <div class="when">${d ? `<b>${pad(d.getDate())}</b><span>${d.toLocaleDateString('fr-FR', { month: 'short' })}</span>` : '<b>?</b><span>date</span>'}</div>
    <div class="what"><strong>${esc(p.title)}</strong><div class="sub">${esc(TYPES[p.type] || p.type)} · ${esc(p.unit_code)}${p.location ? ` · ${esc(p.location)}` : ''} · ${esc(p.owner_name)}${p.code ? ` · <span class="code">${esc(p.code)}</span>` : ''}</div></div>
    <div class="side">${statusPill(p.status)}<span>${p.spend ? money(p.spend) : 'sans budget'}${p.level ? ` · niveau ${p.level}` : ''}${left !== null ? ` · ${left < 0 ? `<b style="color:var(--ko)">en retard de ${-left} j</b>` : `${left} j restants`}` : ''}</span></div>
  </a>`;
}

export function list(rows, opts = {}, emptyText = 'Rien pour le moment.') {
  if (!rows.length) return `<div class="empty">${emptyText}</div>`;
  if (!opts.byMonth) return `<div class="plist">${rows.map((p) => card(p, opts)).join('')}</div>`;
  const groups = new Map();
  for (const p of rows) { const k = (p.starts_at || '0000-00').slice(0, 7); groups.set(k, [...(groups.get(k) || []), p]); }
  return [...groups.entries()].map(([k, ps]) => `<div class="month-head">${k === '0000-00' ? 'Sans date' : esc(monthLabel(k))}</div><div class="plist">${ps.map((p) => card(p, opts)).join('')}</div>`).join('');
}

export async function homeView(app) {
  setTitle('Mon espace');
  const me = state.me;
  const [mine, toValidate] = await Promise.all([api('/projects?scope=mine'), me.flags.isValidator ? api('/projects?scope=validate') : []]);
  const today = new Date().toISOString().slice(0, 10);
  const open = mine.filter((p) => ['brouillon', 'depose', 'complement', 'valide', 'ajourne'].includes(p.status) && (p.starts_at || today) >= today);
  const toClose = mine.filter((p) => ['valide', 'realise'].includes(p.status) && p.starts_at && p.starts_at < today);
  const past = mine.filter((p) => !open.includes(p) && !toClose.includes(p));
  const spendOk = mine.filter((p) => ['valide', 'realise', 'cloture'].includes(p.status)).reduce((s, p) => s + (p.spend || 0), 0);
  app.innerHTML = `
    <div class="page-head"><div><h1>Bonjour ${esc((me.person?.name || '').split(' ')[0])}</h1>
      <p class="meta">${me.posts.length ? me.posts.map((p) => `${esc(p.label)} (${esc(p.unit_code)})${p.deputy ? ' · suppléance' : ''}`).join(' · ') : 'Aucun poste dans l\'organigramme pour l\'instant'}</p></div>
      <span class="spacer"></span>
      <a class="btn primary" href="#/nouveau/simple">Déclarer un projet</a><a class="btn" href="#/nouveau/complet">Projet avec budget ou moyens</a></div>
    ${!me.posts.length && !me.admin ? '<div class="alert warn">Tu n\'es rattaché à aucun poste : tu peux consulter, mais pas encore déposer. Demande au secrétaire de la localité de te placer dans l\'organigramme.</div>' : ''}
    <div class="facts"><div><div class="v">${open.length}</div><div class="l">projets à venir</div></div><div><div class="v">${mine.filter((p) => p.status === 'depose').length}</div><div class="l">en instruction</div></div>
      ${me.flags.isValidator ? `<div><div class="v" style="color:${toValidate.length ? 'var(--r)' : 'inherit'}">${toValidate.length}</div><div class="l">décisions attendues de moi</div></div>` : ''}
      <div><div class="v">${mine.filter((p) => ['cloture', 'realise'].includes(p.status)).length}</div><div class="l">réalisés cette année</div></div><div><div class="v">${money(spendOk)}</div><div class="l">budget validé</div></div></div>
    ${toValidate.length ? `<h2>À valider par moi <a class="btn small quiet" href="#/a-valider">Tout voir</a></h2>${list(toValidate.slice(0, 5), { showDue: true })}` : ''}
    ${toClose.length ? `<h2>Projets passés à clôturer</h2><p class="muted small">Marque-les comme réalisés et dépose le bilan. Un projet passé non clôturé bloque les nouvelles demandes de budget.</p>${list(toClose)}` : ''}
    <h2>Mes projets à venir</h2>
    ${list(open, { byMonth: true }, '<b>Aucun projet en cours.</b>Même une séance de tutorat ou un goûter se déclare : deux minutes, et c\'est tracé, couvert par l\'assurance et visible dans le calendrier.')}
    ${past.length ? `<h2>Historique</h2>${list(past)}` : ''}
    ${me.flags.isValidator ? '<p class="small" style="margin-top:28px"><a href="#/equipe">Voir les projets de mon équipe et de mes structures</a></p>' : ''}`;
}

export async function validateView(app) {
  setTitle('À valider');
  const rows = await api('/projects?scope=validate');
  app.innerHTML = `<div class="page-head"><div><h1>À valider</h1><p class="meta">Les demandes qui attendent ta décision. Le silence ne vaut pas accord : passé le délai, elles remontent à ton responsable.</p></div></div>
    ${list(rows.sort((a, b) => (a.due_at || '').localeCompare(b.due_at || '')), { showDue: true }, '<b>Rien à valider.</b>Tout est à jour.')}`;
}

export async function teamView(app) {
  setTitle('Mon équipe');
  const rows = await api('/projects?scope=team');
  const draw = (filter) => {
    const f = rows.filter((p) => !filter || p.status === filter);
    app.innerHTML = `<div class="page-head"><div><h1>Projets de mon équipe</h1><p class="meta">Les projets portés dans mes structures, par mes délégués ou passés par ma validation.</p></div></div>
      <div class="chips">${[['', 'Tous'], ['depose', 'En instruction'], ['valide', 'Validés'], ['realise', 'Réalisés'], ['cloture', 'Clôturés'], ['brouillon', 'Brouillons']].map(([v, l]) => `<button class="${v === filter ? 'on' : ''}" data-f="${v}">${l} (${rows.filter((p) => !v || p.status === v).length})</button>`).join('')}</div>
      ${list(f, { byMonth: true })}`;
    app.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => draw(b.dataset.f)));
  };
  draw('');
}

export { card, domainPill, levelPill };
