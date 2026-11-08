// Petits utilitaires d'interface
import { STATUSES, DOMAINS, LEVEL_LABELS, APP_NAME } from './shared.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const nl = (s) => esc(s).replace(/\n/g, '<br>');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) { const err = new Error(data?.error || `Erreur ${res.status}`); err.status = res.status; throw err; }
  return data;
}

export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`; t.textContent = msg; box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

export const money = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
export function frDate(iso) { if (!iso) return ''; return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); }
export function longDate(iso) {
  if (!iso) return '';
  const s = new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function dateTime(s) { if (!s) return ''; const d = new Date(`${s.replace(' ', 'T')}Z`); return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
export const daysLeft = (s) => (s ? Math.ceil((new Date(`${s.replace(' ', 'T')}Z`) - Date.now()) / 864e5) : null);
export const monthLabel = (iso) => { const s = new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };

export function setTitle(t) { document.title = t ? `${t} · ${APP_NAME}` : `${APP_NAME} · Projets OMAS Île-de-France`; }

export const statusPill = (s) => `<span class="pill s-${esc(s)}">${esc(STATUSES[s]?.label || s)}</span>`;
export const domainPill = (d) => (d ? `<span class="pill dom">${esc(DOMAINS[d] || d)}</span>` : '');
export const levelPill = (l) => `<span class="pill lvl" title="${esc(LEVEL_LABELS[l] || '')}">Niveau ${l}</span>`;

export function field(label, inner, hint = '') { return `<label>${label}${hint ? ` <span class="hint">${hint}</span>` : ''}${inner}</label>`; }
export function select(id, options, value, { empty } = {}) {
  return `<select id="${id}">${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ''}${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
export const val = (root, id) => root.querySelector(`#${id}`)?.value ?? '';
export const chk = (root, id) => !!root.querySelector(`#${id}`)?.checked;

// Boîte de dialogue légère : confirmation ou saisie d'un motif
export function ask({ title, text = '', placeholder, label = 'Confirmer', danger = false, date = false, dateLabel = '' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `<form method="dialog" class="stack" style="min-width:min(460px,90vw)"><h3 style="margin:0">${esc(title)}</h3>${text ? `<p class="muted small">${esc(text)}</p>` : ''}
      ${placeholder !== undefined ? `<textarea id="dlg-t" placeholder="${esc(placeholder)}" required></textarea>` : ''}
      ${date ? `<label>${esc(dateLabel)}<input id="dlg-d" type="date"></label>` : ''}
      <div class="row" style="justify-content:flex-end"><button type="button" class="quiet" id="dlg-no">Annuler</button><button class="primary ${danger ? 'danger solid' : ''}" id="dlg-ok">${esc(label)}</button></div></form>`;
    document.body.append(d);
    d.querySelector('#dlg-no').onclick = () => { d.close(); d.remove(); resolve(null); };
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); const out = { text: d.querySelector('#dlg-t')?.value?.trim() ?? '', date: d.querySelector('#dlg-d')?.value || null }; if (placeholder !== undefined && !out.text) return; d.close(); d.remove(); resolve(out); };
    d.showModal();
  });
}
