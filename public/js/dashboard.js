// Tableau de bord du bureau, du trésorier et des responsables
import { api, esc, setTitle, money, dateTime, daysLeft, levelPill } from './ui.js';
import { STATUSES, DOMAINS, exerciseLabel } from './shared.js';

export async function dashboardView(app) {
  setTitle('Tableau de bord');
  const d = await api('/dashboard');
  const n = (s) => d.byStatus.find((x) => x.status === s)?.n || 0;
  const engaged = d.byUnit.reduce((s, u) => s + u.engaged, 0);
  const requested = d.byUnit.reduce((s, u) => s + u.requested, 0);
  const maxAct = Math.max(1, ...d.activity.map((a) => a.n));
  app.innerHTML = `<div class="page-head"><div><h1>Tableau de bord</h1><p class="meta">Exercice ${esc(exerciseLabel(d.exercise))}. Ce qui est en instruction, ce qui est engagé, ce qui traîne.</p></div>
    <span class="spacer"></span><a class="btn small" href="/api/export/projets.csv" download>Exporter tout (CSV)</a></div>
    <div class="facts"><div><div class="v">${n('depose')}</div><div class="l">en instruction</div></div><div><div class="v">${n('valide')}</div><div class="l">validés à venir</div></div><div><div class="v">${n('realise') + n('cloture')}</div><div class="l">réalisés</div></div>
      <div><div class="v">${money(engaged)}</div><div class="l">budget engagé (validé)</div></div><div><div class="v">${money(requested)}</div><div class="l">en demande</div></div><div><div class="v" style="color:${d.late.length ? 'var(--ko)' : 'inherit'}">${d.late.length}</div><div class="l">passés sans clôture</div></div></div>

    <div class="grid cols-2">
      <div class="panel"><h2>Demandes en instruction</h2>
        ${d.pending.length ? `<div class="table-wrap"><table><thead><tr><th>Projet</th><th>Niveau</th><th>Attend</th><th>Échéance</th></tr></thead><tbody>${d.pending.map((p) => { const l = daysLeft(p.due_at); return `<tr class="clickable" data-id="${p.id}"><td><b>${esc(p.title)}</b><div class="small muted">${esc(p.unit_code)} · ${esc(p.owner_name)}</div></td><td>${levelPill(p.level)}</td><td class="small">${esc(p.waiting_on || '')}</td><td class="small ${l < 0 ? '' : ''}" style="${l < 0 ? 'color:var(--ko);font-weight:700' : l <= 2 ? 'color:#8a5a00' : ''}">${l < 0 ? `retard ${-l} j` : `${l} j`}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Rien en attente.</p>'}
      </div>
      <div class="panel"><h2>Par structure</h2>
        <div class="table-wrap"><table><thead><tr><th>Structure</th><th class="num">Projets</th><th class="num">Validés</th><th class="num">Engagé</th><th class="num">En demande</th></tr></thead><tbody>
          ${d.byUnit.map((u) => `<tr><td><b>${esc(u.code)}</b> <span class="muted small">${esc(u.name)}</span></td><td class="num">${u.n}</td><td class="num">${u.n_ok}</td><td class="num">${money(u.engaged)}</td><td class="num">${money(u.requested)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small muted" style="margin-top:10px">Les enveloppes par antenne arrivent avec le lot finances : on comparera l'engagé au plafond.</p>
      </div>
    </div>
    <div class="grid cols-2">
      <div class="panel"><h2>Activité par mois <span class="hint muted">(projets validés ou réalisés)</span></h2>
        ${d.activity.length ? `<div class="bars" style="margin-bottom:26px">${d.activity.map((a) => `<div style="height:${Math.round((a.n / maxAct) * 100)}%"><i>${a.n}</i><span>${esc(new Date(`${a.month}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' }))}</span></div>`).join('')}</div>` : '<p class="muted">Pas encore de projet validé cet exercice.</p>'}
        <h3>Par pôle ou filière</h3><div class="tags">${d.byDomain.map((x) => `<span><b>${x.n}</b> ${esc(DOMAINS[x.domain] || x.domain)}</span>`).join('') || '<span class="muted">Rien pour l\'instant.</span>'}</div>
      </div>
      <div class="panel"><h2>Projets passés sans clôture</h2>
        ${d.late.length ? `<div class="table-wrap"><table><tbody>${d.late.map((p) => `<tr class="clickable" data-id="${p.id}"><td><b>${esc(p.title)}</b><div class="small muted">${esc(p.unit_code)} · ${esc(p.owner_name)}</div></td><td class="small">${esc(p.starts_at)}</td><td class="small">${esc(STATUSES[p.status]?.label || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Tout est clôturé.</p>'}
      </div>
    </div>`;
  app.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/projet/${tr.dataset.id}`; }));
}
