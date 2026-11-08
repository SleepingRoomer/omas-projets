// Planning généré à partir des projets : vue mois ou liste, « mon planning » ou toute la localité, abonnement agenda
import { api, esc, setTitle, toast, monthLabel } from './ui.js';
import { state } from './app.js';
import { PLANNING_KINDS, addDays, DOMAINS } from './shared.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const LABEL = { projet: '', instruction: 'En instruction · ', com: 'Lancer la com · ', logi: 'Confirmer la logistique · ', bilan: 'Bilan à déposer · ', decision: 'Décider · ' };

function chip(it, compact = false) {
  return `<a class="chip k-${esc(it.kind)} ${it.late ? 'late' : ''}" href="#/projet/${it.project_id}" title="${esc(PLANNING_KINDS[it.kind])} : ${esc(it.title)}">${it.time && !compact ? `<b>${esc(it.time)}</b> ` : ''}${compact ? '' : esc(LABEL[it.kind])}${esc(it.title)}</a>`;
}

// Un projet sur plusieurs jours occupe chaque jour (14 au plus)
function spread(items) {
  const out = [];
  for (const it of items) {
    out.push(it);
    if (it.end && it.end > it.date) { let d = addDays(it.date, 1); let n = 0; while (d <= it.end && n++ < 14) { out.push({ ...it, date: d, time: null, cont: true }); d = addDays(d, 1); } }
  }
  return out;
}

export async function planningView(app, params) {
  setTitle('Planning');
  const me = state.me;
  let scope = params.get('vue') === 'localite' || !me.person ? 'all' : 'me';
  let mode = params.get('format') || (window.innerWidth < 700 ? 'liste' : 'mois');
  const now = new Date();
  let month = new Date(now.getFullYear(), now.getMonth(), 1);
  let unit = '';
  const draw = async () => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(first); gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const last = new Date(month.getFullYear(), month.getMonth() + (mode === 'liste' ? 2 : 1), 0);
    const gridEnd = new Date(last); gridEnd.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7) - 1));
    const raw = await api(`/planning?scope=${scope}&from=${iso(mode === 'mois' ? gridStart : first)}&to=${iso(mode === 'mois' ? gridEnd : last)}`);
    const items = raw.filter((i) => !unit || i.unit_code === unit);
    const byDay = new Map();
    for (const it of spread(items)) byDay.set(it.date, [...(byDay.get(it.date) || []), it]);
    const todayIso = iso(new Date());
    const counts = Object.fromEntries(Object.keys(PLANNING_KINDS).map((k) => [k, items.filter((i) => i.kind === k).length]));
    let body = '';
    if (mode === 'mois') {
      const cells = [];
      for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
        const k = iso(d); const its = byDay.get(k) || [];
        cells.push(`<div class="day ${d.getMonth() !== month.getMonth() ? 'out' : ''} ${k === todayIso ? 'today' : ''}"><div class="dn">${d.getDate()}</div>${its.slice(0, 4).map((i) => chip(i, true)).join('')}${its.length > 4 ? `<span class="more">+${its.length - 4}</span>` : ''}</div>`);
      }
      body = `<div class="cal"><div class="cal-head">${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((x) => `<div>${x}</div>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></div>`;
    } else {
      const days = [...byDay.entries()].filter(([d]) => d >= iso(first) && d <= iso(last)).sort();
      body = days.length ? days.map(([d, its]) => `<div class="lday ${d === todayIso ? 'today' : ''}"><div class="ld">${esc(cap(new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })))}</div><div class="litems">${its.map((i) => `<div class="litem">${chip(i)}<span class="small muted">${esc(i.unit_code)}${i.location && (i.kind === 'projet' || i.kind === 'instruction') ? ` · ${esc(i.location)}` : ''}${i.domain ? ` · ${esc(DOMAINS[i.domain] || i.domain)}` : ''}</span></div>`).join('')}</div></div>`).join('')
        : '<div class="empty"><b>Rien sur cette période.</b>Le planning se remplit tout seul à partir des projets déclarés et validés.</div>';
    }
    app.innerHTML = `<div class="page-head"><div><h1>Planning</h1><p class="meta">${scope === 'me' ? 'Généré à partir de tes projets : leurs dates, les jalons à tenir (communication, logistique, bilan) et les décisions qu\'on attend de toi.' : 'Tous les projets validés de la localité, pour éviter les doublons entre antennes.'}</p></div>
      <span class="spacer"></span>${me.person ? '<button id="ical">S\'abonner dans mon agenda</button>' : ''}</div>
      <div class="row" style="margin:6px 0 14px;gap:14px">
        ${me.person ? `<div class="seg two" style="margin:0;width:330px"><button class="${scope === 'me' ? 'on' : ''}" data-s="me">Mon planning</button><button class="${scope === 'all' ? 'on' : ''}" data-s="all">Toute la localité</button></div>` : ''}
        <div class="seg two" style="margin:0;width:220px"><button class="${mode === 'mois' ? 'on' : ''}" data-m="mois">Mois</button><button class="${mode === 'liste' ? 'on' : ''}" data-m="liste">Liste</button></div>
        <span class="spacer"></span><button class="small" id="prev">←</button><b>${esc(monthLabel(iso(month)))}${mode === 'liste' ? ` et ${esc(monthLabel(iso(new Date(month.getFullYear(), month.getMonth() + 1, 1))).toLowerCase())}` : ''}</b><button class="small" id="next">→</button><button class="small quiet" id="today">Aujourd'hui</button>
      </div>
      ${scope === 'all' ? `<div class="chips" style="margin-bottom:12px">${[['', 'Toutes les structures'], ...me.units.map((u) => [u.code, u.code])].map(([v, l]) => `<button class="${v === unit ? 'on' : ''}" data-u="${v}">${esc(l)}</button>`).join('')}</div>` : `<div class="legend">${Object.entries(PLANNING_KINDS).filter(([k]) => counts[k]).map(([k, l]) => `<span><i class="k-${k}"></i>${esc(l)} · ${counts[k]}</span>`).join('')}</div>`}
      ${body}`;
    app.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.s; unit = ''; draw(); }));
    app.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    app.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => { unit = b.dataset.u; draw(); }));
    app.querySelector('#prev').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); draw(); };
    app.querySelector('#next').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); draw(); };
    app.querySelector('#today').onclick = () => { month = new Date(now.getFullYear(), now.getMonth(), 1); draw(); };
    app.querySelector('#ical')?.addEventListener('click', () => icalDialog());
  };
  await draw();
}

async function icalDialog() {
  let { url } = await api('/planning/ical');
  if (!url) url = (await api('/planning/ical', { method: 'POST' })).url;
  const d = document.createElement('dialog');
  const render = () => {
    d.innerHTML = `<div class="stack" style="max-width:560px"><h3 style="margin:0">Ton planning dans ton agenda</h3>
      <p class="small muted">Copie ce lien et ajoute-le comme agenda par URL : Google Agenda (Autres agendas › À partir de l'URL), Apple Calendrier (Fichier › Nouvel abonnement), Outlook (Ajouter un calendrier › S'abonner à partir du web). Il se met à jour tout seul, plusieurs fois par jour.</p>
      <label>Mon planning<input id="u1" value="${esc(url)}" readonly></label>
      <label>Toute la localité<input id="u2" value="${esc(url)}?scope=all" readonly></label>
      <p class="small muted">Le lien est personnel : quiconque l'a peut lire ton planning. S'il a circulé, crée-en un nouveau, l'ancien cessera de marcher.</p>
      <div class="row"><button class="quiet" id="regen">Créer un nouveau lien</button><span class="spacer"></span><button id="copy">Copier mon lien</button><button class="primary" id="ok">Fermer</button></div></div>`;
    d.querySelector('#ok').onclick = () => { d.close(); d.remove(); };
    d.querySelector('#copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { d.querySelector('#u1').select(); } };
    d.querySelector('#regen').onclick = async () => { url = (await api('/planning/ical', { method: 'POST' })).url; render(); toast('Nouveau lien créé, l\'ancien ne marche plus'); };
  };
  document.body.append(d); render(); d.showModal();
}
