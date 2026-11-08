// Demandes entre responsables : boîte de réception, envoi, fil d'échange
import { api, esc, nl, toast, setTitle, dateTime, ask, longDate } from './ui.js';
import { state } from './app.js';
import { REQUEST_KINDS, REQUEST_STATUSES, DOMAINS } from './shared.js';

const pill = (s) => `<span class="pill r-${esc(s)}">${esc(REQUEST_STATUSES[s]?.label || s)}</span>`;

function row(r, box) {
  return `<a class="pcard req ${r.status === 'ouverte' && box === 'in' ? 'soon' : ''}" href="#/demande/${r.id}">
    <div class="when"><b class="req-ico">${box === 'in' ? '↓' : '↑'}</b><span>${esc(new Date(`${r.updated_at.replace(' ', 'T')}Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))}</span></div>
    <div class="what"><strong>${esc(r.subject)}</strong><div class="sub">${box === 'in' ? `De ${esc(r.from_name)}${r.from_post_label ? `, ${esc(r.from_post_label)} (${esc(r.from_unit)})` : ''}` : `À ${esc(r.to_post_label)} (${esc(r.to_unit)})`}${r.project_title ? ` · projet « ${esc(r.project_title)} »` : ''}</div></div>
    <div class="side">${pill(r.status)}<span>${esc(REQUEST_KINDS[r.kind] || r.kind)} · ${r.n_messages} message${r.n_messages > 1 ? 's' : ''}</span></div></a>`;
}

export async function requestsView(app, box = 'in') {
  setTitle('Demandes');
  const [inbox, out] = await Promise.all([api('/requests?box=in'), api('/requests?box=out')]);
  const rows = box === 'in' ? inbox : out;
  const open = inbox.filter((r) => r.status === 'ouverte').length;
  app.innerHTML = `<div class="page-head"><div><h1>Demandes</h1><p class="meta">Informer un pôle, demander un avis, proposer une collaboration : les échanges entre responsables restent ici, rattachés au projet, et plus dans les conversations personnelles.</p></div>
    <span class="spacer"></span><a class="btn primary" href="#/demandes/nouvelle">Nouvelle demande</a></div>
    <div class="tabs"><a href="#/demandes" class="${box === 'in' ? 'active' : ''}">Reçues${open ? ` (${open} en attente)` : ''}</a><a href="#/demandes/envoyees" class="${box === 'out' ? 'active' : ''}">Envoyées (${out.length})</a></div>
    ${rows.length ? `<div class="plist">${rows.map((r) => row(r, box)).join('')}</div>` : `<div class="empty"><b>${box === 'in' ? 'Aucune demande reçue.' : 'Aucune demande envoyée.'}</b>${box === 'in' ? 'Quand un responsable te sollicite, sa demande arrive ici et par e-mail.' : 'Depuis un projet ou ce bouton, sollicite le pôle ou la filière qui doit être au courant.'}</div>`}`;
}

export async function newRequestView(app, params) {
  setTitle('Nouvelle demande');
  const me = state.me;
  const [targets, mine] = await Promise.all([api('/requests/targets'), api('/projects?scope=mine')]);
  const projectId = params.get('projet') || '';
  const preTo = (params.get('a') || '').split(',').map(Number).filter(Boolean);
  const selected = new Set(preTo);
  const myIds = new Set(me.posts.map((p) => p.id));
  const project = mine.find((p) => String(p.id) === projectId);
  let filter = '';
  const draw = () => {
    const f = filter.trim().toLowerCase();
    const shown = targets.filter((t) => !myIds.has(t.id) && (!f || `${t.label} ${t.unit_name} ${t.unit_code} ${t.holders.join(' ')} ${DOMAINS[t.domain] || ''}`.toLowerCase().includes(f)));
    const groups = new Map();
    for (const t of shown) groups.set(t.unit_name, [...(groups.get(t.unit_name) || []), t]);
    app.querySelector('#targets').innerHTML = [...groups.entries()].map(([u, ts]) => `<div class="tgroup"><div class="month-head" style="margin-top:10px">${esc(u)}</div>
      ${ts.map((t) => `<label class="check target ${selected.has(t.id) ? 'on' : ''}"><input type="checkbox" data-t="${t.id}" ${selected.has(t.id) ? 'checked' : ''}><span><b>${esc(t.label)}</b><small>${t.holders.length ? esc(t.holders.join(', ')) : 'poste à pourvoir : la demande attendra la nomination'}</small></span></label>`).join('')}</div>`).join('') || '<p class="muted">Aucun poste ne correspond.</p>';
    app.querySelectorAll('[data-t]').forEach((cb) => cb.addEventListener('change', () => { const id = Number(cb.dataset.t); if (cb.checked) selected.add(id); else selected.delete(id); cb.closest('.target').classList.toggle('on', cb.checked); count(); }));
    count();
  };
  const count = () => { app.querySelector('#count').textContent = selected.size ? `${selected.size} destinataire${selected.size > 1 ? 's' : ''} : ${targets.filter((t) => selected.has(t.id)).map((t) => `${t.label} (${t.unit_code})`).join(', ')}` : 'Aucun destinataire choisi'; };
  app.innerHTML = `<a class="back" href="${projectId ? `#/projet/${projectId}` : '#/demandes'}">← Retour</a>
    <div class="page-head"><div><h1>Solliciter un responsable</h1><p class="meta">La demande part au poste, donc à la personne qui le tient aujourd'hui (ou à son suppléant). Elle reçoit un e-mail et répond ici.</p></div></div>
    <form id="f" class="grid cols-2" style="align-items:start">
      <div class="panel" style="margin:0"><h2>À qui</h2>
        <input id="q" type="search" placeholder="Chercher un poste, une antenne, une filière, un nom… ex. psychologie">
        <div id="targets" class="targets"></div></div>
      <div class="panel" style="margin:0"><h2>Quoi</h2>
        <label>Type de demande<select id="kind">${Object.entries(REQUEST_KINDS).map(([k, l]) => `<option value="${k}" ${k === (params.get('type') || 'collaboration') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label>Projet concerné <span class="hint">(facultatif)</span><select id="project"><option value="">Aucun, c'est une demande libre</option>${mine.filter((p) => !['refuse', 'abandonne'].includes(p.status)).map((p) => `<option value="${p.id}" ${String(p.id) === projectId ? 'selected' : ''}>${esc(p.title)}${p.starts_at ? ` · ${esc(p.starts_at)}` : ''}</option>`).join('')}</select></label>
        ${me.posts.length > 1 ? `<label>J'écris en tant que<select id="from">${me.posts.map((p) => `<option value="${p.id}">${esc(p.label)} (${esc(p.unit_code)})</option>`).join('')}</select></label>` : ''}
        <label>Objet<input id="subject" maxlength="160" required value="${esc(project ? project.title : '')}" placeholder="Journée santé mentale : besoin de psychologues"></label>
        <label>Message<textarea id="body" rows="7" required placeholder="Ce que tu prépares, ce que tu attends de la personne (simple information, un avis, des intervenants…), et pour quand."></textarea></label>
        <p class="small muted" id="count"></p>
        <button class="primary" style="width:100%;margin-top:6px">Envoyer la demande</button>
      </div>
    </form>`;
  app.querySelector('#q').addEventListener('input', (e) => { filter = e.target.value; draw(); });
  app.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/requests', { method: 'POST', body: { to_post_ids: [...selected], kind: app.querySelector('#kind').value, project_id: app.querySelector('#project').value || null, from_post_id: app.querySelector('#from')?.value, subject: app.querySelector('#subject').value, body: app.querySelector('#body').value } });
      toast(r.ids.length > 1 ? `${r.ids.length} demandes envoyées` : 'Demande envoyée');
      location.hash = r.ids.length === 1 ? `#/demande/${r.ids[0]}` : '#/demandes/envoyees';
    } catch (err) { toast(err.message, 'error'); }
  });
  draw();
}

export async function requestView(app, id) {
  const d = await api(`/requests/${id}`);
  const { request: r, messages, holders, can } = d;
  setTitle(r.subject);
  const meId = state.me.person?.id;
  const sys = { acceptee: 'a accepté', vue: 'a répondu « bien noté »', declinee: 'a décliné', close: 'a clos la demande', reouverte: 'a rouvert la demande' };
  app.innerHTML = `<a class="back" href="#/demandes${can.side === 'target' ? '' : '/envoyees'}">← Demandes</a>
    <div class="page-head"><div><h1>${esc(r.subject)}</h1>
      <p class="meta">${esc(REQUEST_KINDS[r.kind] || r.kind)} · de <b>${esc(r.from_name)}</b>${r.from_post_label ? ` (${esc(r.from_post_label)}${r.from_post_label.includes(r.from_unit) ? '' : `, ${esc(r.from_unit)}`})` : ''} à <b>${esc(r.to_post_label)}</b> (${esc(r.to_unit_name)})${holders.length ? ` : ${esc(holders.join(', '))}` : ', poste à pourvoir'}</p></div>
      <span class="spacer"></span>${pill(r.status)}</div>
    ${r.project_id ? `<a class="pcard" href="#/projet/${r.project_id}" style="margin:12px 0"><div class="when"><b>📌</b></div><div class="what"><strong>${esc(r.project_title)}</strong><div class="sub">${r.project_date ? esc(longDate(r.project_date)) : 'date à fixer'}${r.project_code ? ` · <span class="code">${esc(r.project_code)}</span>` : ''}</div></div><div class="side"><span>Ouvrir le projet</span></div></a>` : ''}
    <div class="thread">${messages.map((m) => (m.kind === 'message'
    ? `<div class="msg ${m.person_id === meId ? 'mine' : ''}"><div class="who">${esc(m.name || '')} <span class="when">· ${esc(dateTime(m.at))}</span></div><div class="body">${nl(m.body)}</div></div>`
    : `<div class="sysmsg"><b>${esc(m.name || '')}</b> ${esc(sys[m.kind] || m.kind)} · ${esc(dateTime(m.at))}${m.body ? `<div class="body">${nl(m.body)}</div>` : ''}</div>`)).join('')}</div>
    ${can.canAnswer ? `<div class="panel" style="border-color:var(--a)"><h2>Ta réponse</h2><p class="muted small">Tu es sollicité en tant que ${esc(r.to_post_label)}. Réponds d'un clic ; tu peux aussi écrire un message dessous avant.</p>
      <div class="decide"><button class="primary" data-ans="acceptee">J'en suis, j'accepte</button><button data-ans="vue">Bien noté</button><button class="danger" data-ans="declinee">Décliner</button></div></div>` : ''}
    ${can.canReply ? '<form id="rf" class="panel"><label for="rb" style="margin-top:0">Écrire un message</label><textarea id="rb" rows="3" required placeholder="Ta réponse, une question, une précision…"></textarea><div class="row" style="margin-top:10px"><button class="primary">Envoyer</button><span class="spacer"></span>' + (can.canClose ? '<button type="button" class="quiet" id="close">Clore la demande</button>' : '') + '</div></form>' : ''}
    ${can.canReopen ? '<button id="reopen">Rouvrir la demande</button>' : ''}`;
  app.querySelector('#rf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/requests/${id}/messages`, { method: 'POST', body: { body: app.querySelector('#rb').value } }); requestView(app, id); } catch (err) { toast(err.message, 'error'); }
  });
  app.querySelectorAll('[data-ans]').forEach((b) => b.addEventListener('click', async () => {
    const st = b.dataset.ans;
    let body = '';
    if (st === 'declinee') { const a = await ask({ title: 'Décliner la demande', placeholder: 'Pourquoi, en une phrase (lu par la personne)…', label: 'Décliner', danger: true }); if (!a) return; body = a.text; }
    if (st === 'acceptee') { const a = await ask({ title: 'Accepter', text: r.project_id ? 'Le projet apparaîtra dans ton planning.' : '', label: 'Accepter' }); if (!a) return; }
    try { await api(`/requests/${id}/answer`, { method: 'POST', body: { status: st, body } }); toast('Réponse envoyée'); requestView(app, id); state.me = null; } catch (err) { toast(err.message, 'error'); }
  }));
  app.querySelector('#close')?.addEventListener('click', async () => { if (!(await ask({ title: 'Clore cette demande ?', text: 'Plus personne ne pourra y répondre, sauf à la rouvrir.', label: 'Clore' }))) return; await api(`/requests/${id}/close`, { method: 'POST' }); requestView(app, id); });
  app.querySelector('#reopen')?.addEventListener('click', async () => { await api(`/requests/${id}/close`, { method: 'POST', body: { reopen: true } }); requestView(app, id); });
}
