// E-mails automatiques via Brevo. Sans clé, rien ne part : le message est journalisé « non envoyé » et le site marche quand même.
import { APP_NAME, LOCALITY } from '../public/js/shared.js';

const FAKE = /@(exemple|example)\.(org|com|fr)$/i;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const longDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');

export function layout({ title, intro = '', rows = [], button = null, after = '', foot = '' }) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f6fa;font-family:Arial,Helvetica,sans-serif;color:#191a3f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #e3e5ee">
<tr><td style="padding:22px 28px 6px"><span style="font-weight:900;font-size:24px;letter-spacing:-0.5px;color:#2d2f84">${esc(APP_NAME)}</span>
<span style="font-size:12px;color:#4a4c68;margin-left:8px">par <b style="color:#2d2f84">OMAS</b> <b style="color:#00807b">ÎLE-DE-FRANCE</b></span></td></tr>
<tr><td style="padding:10px 28px 0"><h1 style="font-size:21px;margin:8px 0 10px">${esc(title)}</h1>${intro ? `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${intro}</p>` : ''}</td></tr>
${rows.length ? `<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;border:1px solid #e3e5ee;border-radius:10px">
${rows.map(([k, v]) => `<tr><td style="padding:9px 14px;font-size:13px;color:#4a4c68;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:9px 14px;font-size:15px;font-weight:bold">${v}</td></tr>`).join('')}
</table></td></tr>` : ''}
${button ? `<tr><td style="padding:20px 28px 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#2d2f84;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:9px">${esc(button.label)}</a></td></tr>` : ''}
${after ? `<tr><td style="padding:14px 28px 0;font-size:14px;line-height:1.55">${after}</td></tr>` : ''}
<tr><td style="padding:22px 28px 24px;font-size:12px;color:#6e7090;line-height:1.5">${foot || `${esc(APP_NAME)}, la plateforme des projets d'${esc(LOCALITY)}.`}<br>Message automatique : pour toute question, réponds à cet e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}

export function mailReady(env) { return !!(env.BREVO_API_KEY && env.MAIL_FROM); }

export function siteUrl(env, c) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, '');
  if (c) return new URL(c.req.url).origin;
  return '';
}

// Envoi groupé : un appel Brevo pour 200 destinataires
export async function sendMails(env, db, msgs) {
  const log = [];
  const ok = msgs.filter((m) => m.to && !FAKE.test(m.to));
  for (const m of msgs.filter((x) => !ok.includes(x))) log.push({ ...m, status: 'skipped', error: m.to ? 'adresse fictive' : 'pas d\'adresse' });
  if (!mailReady(env)) for (const m of ok) log.push({ ...m, status: 'skipped', error: 'e-mails non configurés' });
  else {
    for (let i = 0; i < ok.length; i += 200) {
      const chunk = ok.slice(i, i + 200);
      const body = {
        sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || `${APP_NAME} · OMAS IDF` },
        ...(env.MAIL_REPLY_TO ? { replyTo: { email: env.MAIL_REPLY_TO } } : {}),
        subject: chunk[0].subject, htmlContent: chunk[0].html, to: [{ email: chunk[0].to }],
        messageVersions: chunk.map((m) => ({ to: [{ email: m.to, ...(m.name ? { name: m.name } : {}) }], subject: m.subject, htmlContent: m.html })),
        tags: [...new Set(chunk.map((m) => m.kind))].slice(0, 5),
      };
      let status = 'sent'; let error = null;
      try {
        const r = await fetch(env.BREVO_URL || 'https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) { status = 'failed'; error = `${r.status} ${(await r.text()).slice(0, 200)}`; }
      } catch (e) { status = 'failed'; error = String(e.message || e).slice(0, 200); }
      for (const m of chunk) log.push({ ...m, status, error });
    }
  }
  const stmts = [];
  for (let i = 0; i < log.length; i += 16) {
    const part = log.slice(i, i + 16);
    stmts.push(db.prepare(`INSERT INTO mail_log (kind, ref, to_email, subject, status, error) VALUES ${part.map(() => '(?,?,?,?,?,?)').join(',')}`)
      .bind(...part.flatMap((m) => [m.kind, m.ref ?? null, m.to || '', m.subject, m.status, m.error ?? null])));
  }
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return { sent: log.filter((m) => m.status === 'sent').length, skipped: log.filter((m) => m.status === 'skipped').length, failed: log.filter((m) => m.status === 'failed').length, ready: mailReady(env) };
}

// Envoi après la réponse, pour ne pas faire attendre la personne
export function later(c, p) { try { c.executionCtx.waitUntil(p.catch((e) => console.error(e))); } catch { return p.catch((e) => console.error(e)); } return null; }

export function magicLinkMail({ to, name, url }) {
  return {
    to, name, kind: 'connexion', subject: `Ta connexion à ${APP_NAME}`,
    html: layout({
      title: 'Ton lien de connexion',
      intro: `Bonjour ${esc(name || '')}, clique sur le bouton pour ouvrir ${esc(APP_NAME)}. Le lien vaut 30 minutes et ne sert qu'une fois.`,
      button: { label: 'Me connecter', url },
      after: 'Si tu n\'as rien demandé, ignore ce message : personne ne peut se connecter sans ce lien.',
    }),
  };
}
