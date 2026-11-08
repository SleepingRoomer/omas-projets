// Organigramme vivant : qui tient quel poste, qui valide qui
import { api, esc, setTitle, toast, ask } from './ui.js';
import { state } from './app.js';
import { DOMAINS } from './shared.js';

export async function orgView(app) {
  setTitle('Organigramme');
  const me = state.me;
  const o = await api('/org');
  const postById = Object.fromEntries(o.posts.map((p) => [p.id, p]));
  const holders = (pid) => o.holders.filter((h) => h.post_id === pid);
  const deps = (pid) => o.deputies.filter((d) => d.post_id === pid);
  const myIds = me.posts.filter((p) => !p.deputy).map((p) => p.id);
  const unitBlock = (u) => {
    const posts = o.posts.filter((p) => p.unit_id === u.id && p.active);
    if (!posts.length) return '';
    return `<div class="panel flush org-unit"><div style="padding:14px 16px;border-bottom:1px solid var(--line)"><b>${esc(u.name)}</b> <span class="muted small">· ${esc(u.code)} · ${u.kind}</span></div>
      ${posts.map((p) => `<div class="org-post"><div class="lbl"><b>${esc(p.label)}</b><span>${p.domain ? `${esc(DOMAINS[p.domain] || p.domain)} · ` : ''}${p.parent_id ? `valide par : ${esc(postById[p.parent_id]?.label || '?')}` : 'sommet'}${p.functional_id ? ` · informe : ${esc(postById[p.functional_id]?.label || '')}` : ''}${p.is_bureau ? ' · bureau' : ''}${p.is_treasurer ? ' · trésorier' : ''}</span></div>
        <div class="names">${holders(p.id).length ? holders(p.id).map((h) => esc(h.name)).join(', ') : '<span class="vac">poste à pourvoir</span>'}${deps(p.id).map((d) => `<div class="small">suppléance : ${esc(d.name)} du ${esc(d.start_date)} au ${esc(d.end_date)}${myIds.includes(p.id) || me.admin ? ` <button class="small quiet" data-deldep="${d.id}">retirer</button>` : ''}</div>`).join('')}</div>
        <div>${myIds.includes(p.id) ? `<button class="small" data-dep="${p.id}">Désigner un suppléant</button>` : ''}</div></div>`).join('')}</div>`;
  };
  app.innerHTML = `<div class="page-head"><div><h1>Organigramme</h1><p class="meta">Les postes et les personnes qui les tiennent aujourd'hui. C'est lui qui décide à qui part chaque demande.${me.admin ? ' <a href="#/admin/organigramme">Modifier</a>.' : ''}</p></div></div>
    ${o.units.filter((u) => u.active).map(unitBlock).join('')}`;
  app.querySelectorAll('[data-dep]').forEach((b) => b.addEventListener('click', async () => {
    const people = await api('/people');
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog" class="stack" style="min-width:min(440px,90vw)"><h3 style="margin:0">Suppléance pour ${esc(postById[b.dataset.dep].label)}</h3><p class="muted small">Pendant la période, cette personne reçoit et décide à ta place.</p>
      <label>Qui<select id="dp">${people.filter((x) => x.id !== me.person?.id).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <label>Du<input id="d1" type="date" required></label><label>Au<input id="d2" type="date" required></label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="quiet" id="no">Annuler</button><button class="primary">Désigner</button></div></form>`;
    document.body.append(d); d.showModal();
    d.querySelector('#no').onclick = () => { d.close(); d.remove(); };
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/deputies', { method: 'POST', body: { post_id: Number(b.dataset.dep), person_id: Number(d.querySelector('#dp').value), start_date: d.querySelector('#d1').value, end_date: d.querySelector('#d2').value } }); d.close(); d.remove(); toast('Suppléance enregistrée'); orgView(app); } catch (err) { toast(err.message, 'error'); }
    };
  }));
  app.querySelectorAll('[data-deldep]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ask({ title: 'Retirer cette suppléance ?', label: 'Retirer', danger: true }))) return;
    try { await api(`/deputies/${b.dataset.deldep}`, { method: 'DELETE' }); orgView(app); } catch (err) { toast(err.message, 'error'); }
  }));
}
