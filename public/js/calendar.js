// Calendrier partagé de la localité
import { api, esc, setTitle, statusPill, monthLabel } from './ui.js';
import { state } from './app.js';
import { TYPES, DOMAINS } from './shared.js';

export async function calendarView(app) {
  setTitle('Calendrier');
  const me = state.me;
  const today = new Date();
  let from = new Date(today.getFullYear(), today.getMonth(), 1);
  let unit = '';
  const iso = (d) => d.toISOString().slice(0, 10);
  const draw = async () => {
    const to = new Date(from.getFullYear(), from.getMonth() + 3, 0);
    const rows = await api(`/calendar?from=${iso(from)}&to=${iso(to)}`);
    const shown = rows.filter((p) => !unit || String(p.unit_id) === unit);
    const byDay = new Map();
    for (const p of shown) byDay.set(p.starts_at, [...(byDay.get(p.starts_at) || []), p]);
    const months = [0, 1, 2].map((i) => new Date(from.getFullYear(), from.getMonth() + i, 1));
    app.innerHTML = `<div class="page-head"><div><h1>Calendrier</h1><p class="meta">Tout ce qui est validé dans la localité, pour éviter les doublons entre antennes et rendre visible le travail de chacun.</p></div>
      <span class="spacer"></span><div class="row"><button class="small" id="prev">←</button><b>${esc(monthLabel(iso(from)))} à ${esc(monthLabel(iso(to)))}</b><button class="small" id="next">→</button></div></div>
      <div class="row" style="margin:8px 0 4px"><div class="chips">${[['', 'Toutes les structures'], ...me.units.map((u) => [String(u.id), u.code])].map(([v, l]) => `<button class="${v === unit ? 'on' : ''}" data-u="${v}">${esc(l)}</button>`).join('')}</div>
      <span class="spacer"></span><span class="muted small">${shown.length} projet${shown.length > 1 ? 's' : ''}</span></div>
      ${months.map((m) => {
    const key = iso(m).slice(0, 7);
    const days = [...byDay.entries()].filter(([d]) => d.startsWith(key)).sort();
    return `<div class="month-head">${esc(monthLabel(iso(m)))}</div>${days.length ? `<div class="table-wrap"><table><tbody>${days.map(([d, ps]) => ps.map((p, i) => `<tr class="clickable" data-id="${p.id}">
        ${i === 0 ? `<td rowspan="${ps.length}" style="width:120px;vertical-align:top"><b>${esc(new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }))}</b></td>` : ''}
        <td style="width:70px" class="muted small">${esc(p.start_time || '')}</td><td><b>${esc(p.title)}</b><div class="small muted">${esc(TYPES[p.type] || '')}${p.location ? ` · ${esc(p.location)}` : ''} · ${esc(p.owner_name)}</div></td>
        <td class="small"><span class="pill">${esc(p.unit_code)}</span> ${p.domain ? `<span class="pill dom">${esc(DOMAINS[p.domain] || p.domain)}</span>` : ''}</td><td>${p.status === 'depose' ? statusPill(p.status) : ''}</td></tr>`).join('')).join('')}</tbody></table></div>` : '<p class="muted small">Rien de prévu.</p>'}`;
  }).join('')}`;
    app.querySelector('#prev').onclick = () => { from = new Date(from.getFullYear(), from.getMonth() - 3, 1); draw(); };
    app.querySelector('#next').onclick = () => { from = new Date(from.getFullYear(), from.getMonth() + 3, 1); draw(); };
    app.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => { unit = b.dataset.u; draw(); }));
    app.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/projet/${tr.dataset.id}`; }));
  };
  await draw();
}
