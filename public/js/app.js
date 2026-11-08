import { api, esc, toast, setTitle } from './ui.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
export const state = { me: null };

function renderNav() {
  const me = state.me;
  if (!me || me.anonymous) { nav.innerHTML = ''; return; }
  const links = [['#/', 'Mon espace']];
  if (me.flags.isValidator) links.push(['#/a-valider', 'À valider']);
  links.push(['#/calendrier', 'Calendrier']);
  if (me.flags.isValidator) links.push(['#/tableau', 'Tableau de bord']);
  links.push(['#/organigramme', 'Organigramme']);
  if (me.admin) links.push(['#/admin', 'Administration']);
  const here = (location.hash || '#/').split('?')[0];
  nav.innerHTML = links.map(([h, l]) => `<a href="${h}" class="${here === h ? 'active' : ''}">${esc(l)}</a>`).join('')
    + `<span class="who">${esc(me.person?.name || 'Compte technique')}</span><button id="logout">Se déconnecter</button>`;
  document.getElementById('logout')?.addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    state.me = { anonymous: true };
    location.hash = '#/';
    route();
  });
}

function loginView(params) {
  setTitle('Connexion');
  let mode = params.get('mode') === 'admin' ? 'admin' : 'email';
  const draw = (sentTo = null, devLink = null) => {
    app.innerHTML = `
      <div class="login">
        <div class="intro">
          <div class="login-mark"><span class="wordmark"><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#2d2f84"/><path d="M32 10 44 44 32 36 20 44z" fill="#fff"/><path d="M32 36 44 44 32 54 20 44z" fill="#00a09a"/></svg>Cap</span></div>
          <p class="by">La plateforme des projets d'<b>OMAS <span>ÎLE-DE-FRANCE</span></b></p>
          <h1>Un projet, une fiche, un feu vert.</h1>
          <p class="lede">Chaque responsable déclare ici ce qu'il organise, avec ou sans budget. La demande part automatiquement à la bonne personne, qui a un délai pour répondre. Validé, le projet reçoit un code qui suit chaque dépense jusqu'au bilan.</p>
        </div>
        <div class="door">
          <h2>Se connecter</h2>
          <div class="seg two" role="tablist"><button type="button" role="tab" data-m="email" class="${mode === 'email' ? 'on' : ''}">Par e-mail</button><button type="button" role="tab" data-m="admin" class="${mode === 'admin' ? 'on' : ''}">Compte technique</button></div>
          ${sentTo ? `<div class="alert ok">Si <b>${esc(sentTo)}</b> est connue, un lien de connexion vient de partir. Il vaut 30 minutes.${devLink ? `<br><a href="${esc(devLink)}">Lien de test (mode local)</a>` : ''}</div>` : ''}
          <form id="f">
            ${mode === 'email'
    ? '<label for="email">Ton adresse e-mail</label><input id="email" type="email" autocomplete="email" required placeholder="prenom.nom@exemple.fr"><p class="muted small">Pas de mot de passe : tu reçois un lien à usage unique. Ton adresse doit avoir été enregistrée par le secrétaire.</p>'
    : '<label for="pw">Mot de passe</label><input id="pw" type="password" autocomplete="current-password" required><p class="muted small">Réservé à la mise en route et au dépannage.</p>'}
            <button class="primary" style="width:100%;margin-top:18px">${mode === 'email' ? 'Recevoir mon lien' : 'Entrer'}</button>
          </form>
        </div>
      </div>`;
    app.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    app.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        if (mode === 'email') {
          const email = app.querySelector('#email').value.trim();
          const r = await api('/auth/request', { method: 'POST', body: { email } });
          draw(email, r.link || null);
        } else {
          await api('/auth/admin', { method: 'POST', body: { password: app.querySelector('#pw').value } });
          state.me = null; location.hash = '#/admin'; route();
        }
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}

async function consumeLink(token) {
  app.innerHTML = '<p class="muted">Connexion…</p>';
  try {
    await api('/auth/consume', { method: 'POST', body: { token } });
    state.me = null;
    const back = sessionStorage.getItem('after_login'); sessionStorage.removeItem('after_login');
    location.hash = back && !back.startsWith('#/connexion') ? back : '#/';
  } catch (err) {
    app.innerHTML = `<div class="narrow"><div class="alert error">${esc(err.message)}</div><p><a href="#/">Demander un nouveau lien</a></p></div>`;
  }
}

const routes = [
  [/^#\/connexion\/([a-f0-9]+)$/, 'any', (m) => consumeLink(m[1])],
  [/^#\/$/, 'auth', async () => (await import('./home.js')).homeView(app)],
  [/^#\/a-valider$/, 'auth', async () => (await import('./home.js')).validateView(app)],
  [/^#\/equipe$/, 'auth', async () => (await import('./home.js')).teamView(app)],
  [/^#\/nouveau(?:\/(simple|complet))?$/, 'auth', async (m) => (await import('./project.js')).editView(app, null, m[1] || 'simple')],
  [/^#\/projet\/(\d+)\/modifier$/, 'auth', async (m) => (await import('./project.js')).editView(app, m[1])],
  [/^#\/projet\/(\d+)$/, 'auth', async (m) => (await import('./project.js')).projectView(app, m[1])],
  [/^#\/calendrier$/, 'auth', async () => (await import('./calendar.js')).calendarView(app)],
  [/^#\/tableau$/, 'auth', async () => (await import('./dashboard.js')).dashboardView(app)],
  [/^#\/organigramme$/, 'auth', async () => (await import('./org.js')).orgView(app)],
  [/^#\/admin(?:\/([\w-]+))?$/, 'auth', async (m) => (await import('./admin.js')).adminView(app, m[1] || 'personnes')],
];

export async function route() {
  if (!state.me) { try { state.me = await api('/me'); } catch { state.me = { anonymous: true }; } }
  const [hash, qs] = (location.hash || '#/').split('?');
  const params = new URLSearchParams(qs || '');
  renderNav();
  window.scrollTo(0, 0);
  for (const [re, kind, fn] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    if (kind === 'auth' && state.me.anonymous) { sessionStorage.setItem('after_login', location.hash); break; }
    try { await fn(m, params); } catch (err) {
      if (err.status === 401) { state.me = { anonymous: true }; renderNav(); loginView(params); return; }
      app.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
    return;
  }
  if (!state.me.anonymous) { location.hash = '#/'; return; }
  loginView(params);
}

window.addEventListener('hashchange', route);
route();
