// Administration : personnes, organigramme, réglages, état du système
import { api, esc, toast, setTitle, select, val, chk, ask, dateTime } from './ui.js';
import { DOMAINS, POLE_CODES, FILIERE_CODES } from './shared.js';

const TABS = [['personnes', 'Personnes'], ['organigramme', 'Organigramme'], ['reglages', 'Seuils et délais'], ['etat', 'État du système']];
const POST_CODES = [['manager', 'Manager (président)'], ['secretaire', 'Secrétaire'], ['tresorier', 'Trésorier'], ['vm_etudiants', 'Vice-manager étudiants'], ['vm_internes', 'Vice-manager internes et pros'], ['resp_pole', 'Responsable de pôle'], ['resp_filiere', 'Responsable de filière'],
  ['referent_antenne', 'Référent d\'antenne'], ['delegue_pole', 'Délégué de pôle'], ['delegue_filiere', 'Délégué de filière'], ['referent_promo', 'Référent de promo'], ['charge_mission', 'Chargé de mission'], ['referent_internes', 'Référent internes'], ['referent_pros', 'Référent pros'], ['autre', 'Autre']];

export async function adminView(app, tab) {
  setTitle('Administration');
  const head = `<div class="page-head"><div><h1>Administration</h1><p class="meta">Les personnes, l'organigramme et les règles. Modifier l'organigramme change immédiatement qui valide quoi.</p></div></div>
    <div class="tabs">${TABS.map(([t, l]) => `<a href="#/admin/${t}" class="${t === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="tab"></div>`;
  app.innerHTML = head;
  const box = app.querySelector('#tab');
  if (tab === 'personnes') await peopleTab(box);
  else if (tab === 'organigramme') await orgTab(box);
  else if (tab === 'reglages') await rulesTab(box);
  else await stateTab(box);
}

async function peopleTab(box) {
  const [people, org] = await Promise.all([api('/admin/people'), api('/org')]);
  const postLabel = (id) => { const p = org.posts.find((x) => x.id === id); const u = org.units.find((x) => x.id === p?.unit_id); return p ? `${p.label} (${u?.code || ''})` : '?'; };
  box.innerHTML = `
    <div class="panel"><h2>Ajouter une personne</h2><form id="np" class="form-grid">
      <label>Nom<input id="n-name" required placeholder="Prénom Nom"></label><label>E-mail<input id="n-email" type="email" required></label><label>Téléphone <span class="hint">(facultatif)</span><input id="n-phone"></label>
      <label>Premier poste <span class="hint">(facultatif)</span>${select('n-post', org.posts.filter((p) => p.active).map((p) => [p.id, postLabel(p.id)]), '', { empty: 'Aucun pour l\'instant' })}</label>
      <div class="wide row"><label class="check" style="margin:0"><input type="checkbox" id="n-admin"> Administrateur (secrétaire, manager)</label><span class="spacer"></span><button class="primary">Ajouter</button></div></form>
      <p class="small muted">La personne se connecte ensuite avec son adresse e-mail. Sans Brevo, génère-lui un lien depuis la liste.</p></div>
    <div class="table-wrap"><table><thead><tr><th>Nom</th><th>E-mail</th><th>Postes</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
      ${people.map((p) => `<tr class="${p.active ? '' : 'muted'}"><td><b>${esc(p.name)}</b>${p.is_admin ? ' <span class="pill ink">admin</span>' : ''}${p.active ? '' : ' <span class="pill ko">désactivé</span>'}</td><td class="small">${esc(p.email)}</td>
        <td class="small">${org.holders.filter((h) => h.person_id === p.id).map((h) => `${esc(postLabel(h.post_id))} <button class="small quiet" data-unassign="${h.assignment_id}" title="Retirer">✕</button>`).join('<br>') || '<span class="muted">aucun</span>'}<br><button class="small quiet" data-assign="${p.id}">+ poste</button></td>
        <td class="small muted">${p.last_login_at ? esc(dateTime(p.last_login_at)) : 'jamais'}</td>
        <td class="row" style="justify-content:flex-end"><button class="small" data-link="${p.id}">Lien de connexion</button><button class="small quiet" data-edit="${p.id}">Modifier</button></td></tr>`).join('')}
    </tbody></table></div>`;
  box.querySelector('#np').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/admin/people', { method: 'POST', body: { name: val(box, 'n-name'), email: val(box, 'n-email'), phone: val(box, 'n-phone'), is_admin: chk(box, 'n-admin') } });
      if (val(box, 'n-post')) await api('/admin/assign', { method: 'POST', body: { person_id: r.id, post_id: Number(val(box, 'n-post')) } });
      toast('Personne ajoutée'); peopleTab(box);
    } catch (err) { toast(err.message, 'error'); }
  };
  box.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api(`/admin/people/${b.dataset.link}/link`, { method: 'POST', body: { send: false } });
      const d = document.createElement('dialog');
      d.innerHTML = `<div class="stack" style="max-width:520px"><h3 style="margin:0">Lien de connexion</h3><p class="small muted">Valable 30 minutes, une seule fois. À transmettre par un canal sûr.</p><input value="${esc(r.url)}" readonly><div class="row" style="justify-content:flex-end"><button class="primary" id="ok">Fermer</button></div></div>`;
      document.body.append(d); d.showModal(); d.querySelector('#ok').onclick = () => { d.close(); d.remove(); }; d.querySelector('input').select();
    } catch (err) { toast(err.message, 'error'); }
  }));
  box.querySelectorAll('[data-unassign]').forEach((b) => b.addEventListener('click', async () => { if (!(await ask({ title: 'Retirer ce poste ?', label: 'Retirer', danger: true }))) return; await api(`/admin/assign/${b.dataset.unassign}`, { method: 'DELETE' }); peopleTab(box); }));
  box.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', async () => {
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog" class="stack" style="min-width:min(440px,90vw)"><h3 style="margin:0">Ajouter un poste</h3><label>Poste${select('ap', org.posts.filter((p) => p.active).map((p) => [p.id, postLabel(p.id)]), '')}</label><div class="row" style="justify-content:flex-end"><button type="button" class="quiet" id="no">Annuler</button><button class="primary">Ajouter</button></div></form>`;
    document.body.append(d); d.showModal(); d.querySelector('#no').onclick = () => { d.close(); d.remove(); };
    d.querySelector('form').onsubmit = async (e) => { e.preventDefault(); try { await api('/admin/assign', { method: 'POST', body: { person_id: Number(b.dataset.assign), post_id: Number(d.querySelector('#ap').value) } }); d.close(); d.remove(); peopleTab(box); } catch (err) { toast(err.message, 'error'); } };
  }));
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const p = people.find((x) => x.id === Number(b.dataset.edit));
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog" class="stack" style="min-width:min(440px,90vw)"><h3 style="margin:0">Modifier</h3><label>Nom<input id="e-name" value="${esc(p.name)}" required></label><label>E-mail<input id="e-email" type="email" value="${esc(p.email)}" required></label><label>Téléphone<input id="e-phone" value="${esc(p.phone || '')}"></label>
      <label class="check"><input type="checkbox" id="e-admin" ${p.is_admin ? 'checked' : ''}> Administrateur</label><label class="check"><input type="checkbox" id="e-active" ${p.active ? 'checked' : ''}> Compte actif</label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="quiet" id="no">Annuler</button><button class="primary">Enregistrer</button></div></form>`;
    document.body.append(d); d.showModal(); d.querySelector('#no').onclick = () => { d.close(); d.remove(); };
    d.querySelector('form').onsubmit = async (e) => { e.preventDefault(); try { await api(`/admin/people/${p.id}`, { method: 'PUT', body: { name: d.querySelector('#e-name').value, email: d.querySelector('#e-email').value, phone: d.querySelector('#e-phone').value, is_admin: d.querySelector('#e-admin').checked, active: d.querySelector('#e-active').checked } }); d.close(); d.remove(); peopleTab(box); } catch (err) { toast(err.message, 'error'); } };
  }));
}

async function orgTab(box) {
  const org = await api('/org');
  const postLabel = (id) => { const p = org.posts.find((x) => x.id === id); const u = org.units.find((x) => x.id === p?.unit_id); return p ? `${p.label} (${u?.code || ''})` : '—'; };
  const domainOptions = [...POLE_CODES.map((c) => [c, DOMAINS[c]]), ...FILIERE_CODES.map((c) => [c, DOMAINS[c]])];
  box.innerHTML = `
    <div class="grid cols-2">
      <div class="panel"><h2>Nouvelle structure</h2><form id="nu" class="form-grid"><label>Code <span class="hint">(court, ex. SU)</span><input id="u-code" required maxlength="8"></label><label>Nom<input id="u-name" required></label>
        <label>Type${select('u-kind', [['antenne', 'Antenne'], ['branche', 'Branche'], ['localite', 'Localité']], 'antenne')}</label><label>Rattachée à${select('u-parent', org.units.map((u) => [u.id, u.name]), 1, { empty: 'Aucune' })}</label>
        <div class="wide row"><span class="spacer"></span><button class="primary">Créer</button></div></form></div>
      <div class="panel"><h2>Nouveau poste</h2><form id="npo" class="form-grid"><label>Structure${select('p-unit', org.units.filter((u) => u.active).map((u) => [u.id, u.name]), '')}</label><label>Intitulé<input id="p-label" required placeholder="Délégué Savoir"></label>
        <label>Nature${select('p-code', POST_CODES, 'autre')}</label><label>Pôle ou filière${select('p-domain', domainOptions, '', { empty: 'Aucun' })}</label>
        <label>Valide par (N+1)${select('p-parent', org.posts.filter((p) => p.active).map((p) => [p.id, postLabel(p.id)]), '', { empty: 'Sommet' })}</label><label>Informe (lien fonctionnel)${select('p-func', org.posts.filter((p) => p.active).map((p) => [p.id, postLabel(p.id)]), '', { empty: 'Personne' })}</label>
        <div class="wide row"><label class="check" style="margin:0"><input type="checkbox" id="p-bureau"> Bureau restreint</label><label class="check" style="margin:0"><input type="checkbox" id="p-treso"> Trésorier</label><label class="check" style="margin:0"><input type="checkbox" id="p-head"> Chef de la structure</label><span class="spacer"></span><button class="primary">Créer</button></div></form></div>
    </div>
    ${org.units.map((u) => `<div class="panel flush org-unit"><div class="row" style="padding:12px 16px;border-bottom:1px solid var(--line)"><b>${esc(u.name)}</b> <span class="muted small">${esc(u.code)} · ${u.kind}${u.active ? '' : ' · inactive'}</span><span class="spacer"></span><button class="small quiet" data-toggle-unit="${u.id}">${u.active ? 'Désactiver' : 'Réactiver'}</button></div>
      ${org.posts.filter((p) => p.unit_id === u.id).map((p) => `<div class="org-post ${p.active ? '' : 'muted'}"><div class="lbl"><b>${esc(p.label)}</b><span>${p.domain ? `${esc(DOMAINS[p.domain] || p.domain)} · ` : ''}N+1 : ${esc(postLabel(p.parent_id))}${p.functional_id ? ` · informe ${esc(postLabel(p.functional_id))}` : ''}${p.is_bureau ? ' · bureau' : ''}${p.is_treasurer ? ' · trésorier' : ''}${p.is_head ? ' · chef' : ''}${p.active ? '' : ' · inactif'}</span></div>
        <div class="names small">${org.holders.filter((h) => h.post_id === p.id).map((h) => esc(h.name)).join(', ') || '<span class="vac">vacant</span>'}</div><div><button class="small quiet" data-edit-post="${p.id}">Modifier</button></div></div>`).join('')}</div>`).join('')}`;
  box.querySelector('#nu').onsubmit = async (e) => { e.preventDefault(); try { await api('/admin/units', { method: 'POST', body: { code: val(box, 'u-code'), name: val(box, 'u-name'), kind: val(box, 'u-kind'), parent_id: val(box, 'u-parent') || null } }); orgTab(box); } catch (err) { toast(err.message, 'error'); } };
  box.querySelector('#npo').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/admin/posts', { method: 'POST', body: { unit_id: val(box, 'p-unit'), label: val(box, 'p-label'), code: val(box, 'p-code'), domain: val(box, 'p-domain') || null, parent_id: val(box, 'p-parent') || null, functional_id: val(box, 'p-func') || null, is_bureau: chk(box, 'p-bureau'), is_treasurer: chk(box, 'p-treso'), is_head: chk(box, 'p-head') } }); toast('Poste créé'); orgTab(box); } catch (err) { toast(err.message, 'error'); }
  };
  box.querySelectorAll('[data-toggle-unit]').forEach((b) => b.addEventListener('click', async () => { const u = org.units.find((x) => x.id === Number(b.dataset.toggleUnit)); await api(`/admin/units/${u.id}`, { method: 'PUT', body: { active: !u.active } }); orgTab(box); }));
  box.querySelectorAll('[data-edit-post]').forEach((b) => b.addEventListener('click', () => {
    const p = org.posts.find((x) => x.id === Number(b.dataset.editPost));
    const others = org.posts.filter((x) => x.active && x.id !== p.id);
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog" class="stack" style="min-width:min(520px,92vw)"><h3 style="margin:0">${esc(p.label)}</h3>
      <label>Intitulé<input id="x-label" value="${esc(p.label)}" required></label><label>Structure${select('x-unit', org.units.map((u) => [u.id, u.name]), p.unit_id)}</label>
      <label>Nature${select('x-code', POST_CODES, p.code)}</label><label>Pôle ou filière${select('x-domain', domainOptions, p.domain || '', { empty: 'Aucun' })}</label>
      <label>Valide par (N+1)${select('x-parent', others.map((x) => [x.id, postLabel(x.id)]), p.parent_id || '', { empty: 'Sommet' })}</label><label>Informe${select('x-func', others.map((x) => [x.id, postLabel(x.id)]), p.functional_id || '', { empty: 'Personne' })}</label>
      <div class="row"><label class="check" style="margin:0"><input type="checkbox" id="x-bureau" ${p.is_bureau ? 'checked' : ''}> Bureau</label><label class="check" style="margin:0"><input type="checkbox" id="x-treso" ${p.is_treasurer ? 'checked' : ''}> Trésorier</label><label class="check" style="margin:0"><input type="checkbox" id="x-head" ${p.is_head ? 'checked' : ''}> Chef</label><label class="check" style="margin:0"><input type="checkbox" id="x-active" ${p.active ? 'checked' : ''}> Actif</label></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="quiet" id="no">Annuler</button><button class="primary">Enregistrer</button></div></form>`;
    document.body.append(d); d.showModal(); d.querySelector('#no').onclick = () => { d.close(); d.remove(); };
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const g = (id) => d.querySelector(`#${id}`);
      try { await api(`/admin/posts/${p.id}`, { method: 'PUT', body: { label: g('x-label').value, unit_id: g('x-unit').value, code: g('x-code').value, domain: g('x-domain').value || null, parent_id: g('x-parent').value || null, functional_id: g('x-func').value || null, is_bureau: g('x-bureau').checked, is_treasurer: g('x-treso').checked, is_head: g('x-head').checked, active: g('x-active').checked } }); d.close(); d.remove(); orgTab(box); } catch (err) { toast(err.message, 'error'); }
    };
  }));
}

async function rulesTab(box) {
  const { rules } = await api('/admin/settings');
  box.innerHTML = `<div class="panel narrow"><h2>Seuils et délais</h2><p class="muted small">Le niveau d'un projet se déduit de ces seuils. Les délais sont en jours ; passé le délai, la demande remonte au N+2.</p>
    <form id="rf" class="form-grid">
      <label>Niveau 1 jusqu'à (€)<input id="l1" type="number" min="0" value="${rules.l1}"></label><label>Niveau 2 jusqu'à (€)<input id="l2" type="number" min="0" value="${rules.l2}"></label>
      <label>Délai niveau 0 (jours)<input id="d0" type="number" min="1" value="${rules.delays[0]}"></label><label>Délai niveau 1<input id="d1" type="number" min="1" value="${rules.delays[1]}"></label><label>Délai niveau 2<input id="d2" type="number" min="1" value="${rules.delays[2]}"></label><label>Délai niveau 3<input id="d3" type="number" min="1" value="${rules.delays[3]}"></label>
      <label>Voix du bureau nécessaires (niveau 3)<input id="quorum" type="number" min="1" max="9" value="${rules.quorum}"></label><label>Mois de début d'exercice<input id="esm" type="number" min="1" max="12" value="${rules.exercise_start_month}"></label>
      <div class="wide row"><span class="spacer"></span><button class="primary">Enregistrer</button></div></form></div>`;
  box.querySelector('#rf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/admin/settings', { method: 'PUT', body: { rules: { l1: Number(val(box, 'l1')), l2: Number(val(box, 'l2')), delays: { 0: Number(val(box, 'd0')), 1: Number(val(box, 'd1')), 2: Number(val(box, 'd2')), 3: Number(val(box, 'd3')) }, quorum: Number(val(box, 'quorum')), exercise_start_month: Number(val(box, 'esm')) } } }); toast('Réglages enregistrés'); } catch (err) { toast(err.message, 'error'); }
  };
}

async function stateTab(box) {
  const [s, mails] = await Promise.all([api('/admin/state'), api('/admin/mails')]);
  box.innerHTML = `<div class="grid cols-2"><div class="panel"><h2>État</h2><dl class="kv"><dt>E-mails (Brevo)</dt><dd>${s.mail ? '<span class="pill ok">configurés</span>' : '<span class="pill warn">non configurés</span> : les liens de connexion se donnent à la main depuis Personnes'}</dd>
      <dt>Adresse du site</dt><dd>${esc(s.siteUrl)}</dd><dt>Tables</dt><dd class="small">${s.tables.length} tables : ${esc(s.tables.join(', '))}</dd><dt>Dernière tâche quotidienne</dt><dd>${s.lastCron ? `${esc(dateTime(s.lastCron.at))} · ${esc(s.lastCron.detail)}` : 'jamais'}</dd></dl>
      <button id="cron" style="margin-top:12px">Lancer la tâche quotidienne maintenant</button><p class="small muted">Escalades des demandes en retard, rappels à 48 h, rappels de bilan, ménage.</p></div>
    <div class="panel"><h2>Derniers e-mails</h2>${mails.length ? `<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Type</th><th>À</th><th>Statut</th></tr></thead><tbody>${mails.slice(0, 60).map((m) => `<tr><td class="small">${esc(dateTime(m.at))}</td><td class="small">${esc(m.kind)}</td><td class="small">${esc(m.to_email)}</td><td class="small">${esc(m.status)}${m.error ? ` <span class="muted">${esc(m.error)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucun e-mail.</p>'}</div></div>`;
  box.querySelector('#cron').onclick = async () => { try { const r = await api('/admin/cron', { method: 'POST' }); toast(`Fait : ${r.escalated} escalade(s), ${r.reminded} rappel(s), ${r.lateBilans} bilan(s)`); stateTab(box); } catch (err) { toast(err.message, 'error'); } };
}
