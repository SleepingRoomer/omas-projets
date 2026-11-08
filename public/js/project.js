// Fiche projet : création, modification, consultation, décisions
import { api, esc, nl, toast, setTitle, statusPill, domainPill, levelPill, money, longDate, dateTime, daysLeft, field, select, val, chk, ask } from './ui.js';
import { state } from './app.js';
import { TYPES, DOMAINS, POLE_CODES, FILIERE_CODES, LOCATION_KINDS, LEVEL_LABELS, STEP_LABELS, computeLevel, levelReasons, missingFields, sumLines, stepsForLevel, delayDays } from './shared.js';

const PAYMENTS = [['carte', 'Carte de l\'antenne'], ['remboursement', 'Avance puis remboursement'], ['virement', 'Virement direct par le trésorier'], ['gratuit', 'Gratuit ou prêté']];

export async function editView(app, id, mode = 'simple') {
  const me = state.me;
  const [people, org] = await Promise.all([api('/people'), api('/org')]);
  let data = id ? await api(`/projects/${id}`) : null;
  if (id && !data.can.canEdit && !data.can.canEditValidated) { toast('Ce projet ne peut plus être modifié', 'error'); location.hash = `#/projet/${id}`; return; }
  const p = data ? { ...data.project } : { type: 'tutorat', location_kind: 'fac', unit_id: me.posts[0]?.unit_id, owner_post_id: me.posts[0]?.id, domain: me.posts[0]?.domain || null, starts_at: '' };
  let lines = data ? data.lines.map((l) => ({ ...l })) : [];
  let members = data ? data.members.map((m) => m.id) : [];
  let full = mode === 'complet' || lines.length > 0 || !!(p.external_speaker || p.external_com || p.partner || p.needs_material || p.location_kind === 'hors_fac' || p.needs_room || p.needs_com);
  const rules = data?.rules || me.rules;
  setTitle(id ? 'Modifier le projet' : 'Nouveau projet');
  const units = org.units.filter((u) => u.active);
  const unitOptions = units.map((u) => [u.id, u.kind === 'localite' ? `${u.name} (projet de la localité)` : u.name]);
  const domainOptions = [...POLE_CODES.map((c) => [c, `Pôle ${DOMAINS[c]}`]), ...FILIERE_CODES.map((c) => [c, `Filière ${DOMAINS[c]}`]), ['INT', 'Internes'], ['PRO', 'Professionnels'], ['VIE', 'Vie de l\'antenne']];

  const draw = () => {
    const level = computeLevel({ ...p, ...(full ? {} : { external_speaker: 0, external_com: 0, partner: 0, needs_material: 0, national: 0 }) }, full ? lines : [], rules);
    const reasons = levelReasons(p, full ? lines : [], rules);
    const steps = stepsForLevel(level);
    app.innerHTML = `
      <a class="back" href="${id ? `#/projet/${id}` : '#/'}">← Retour</a>
      <div class="page-head"><div><h1>${id ? 'Modifier le projet' : full ? 'Nouveau projet avec budget ou moyens' : 'Déclarer un projet'}</h1>
        <p class="meta">${full ? 'La fiche complète : budget ligne par ligne, moyens demandés, engagements. Le niveau de validation se calcule tout seul.' : 'Deux minutes. Tout ce qui se fait au nom de l\'OMAS se déclare, même sans budget : c\'est ce qui le rend visible, traçable et couvert par l\'assurance.'}</p></div></div>
      <form id="f">
      <div class="panel">
        <h2>L'essentiel</h2>
        <div class="form-grid">
          ${field('Titre du projet', `<input id="title" value="${esc(p.title || '')}" maxlength="140" required placeholder="Séance de tutorat PASS, Petit-déjeuner de rentrée, Conférence éthique…">`).replace('<label>', '<label class="wide">')}
          ${field('Type', select('type', Object.entries(TYPES), p.type))}
          ${field('Structure porteuse', select('unit_id', unitOptions, p.unit_id))}
          ${field('Pôle ou filière', select('domain', domainOptions, p.domain, { empty: 'Choisir…' }), 'sert au code projet et aux bilans')}
          ${me.posts.length > 1 ? field('Je porte ce projet en tant que', select('owner_post_id', me.posts.map((x) => [x.id, `${x.label} (${x.unit_code})`]), p.owner_post_id)) : ''}
          ${field('Date', `<input id="starts_at" type="date" value="${esc(p.starts_at || '')}" required>`)}
          ${field('Heure', `<input id="start_time" type="time" value="${esc(p.start_time || '')}">`, 'facultatif')}
          ${field('Date de fin', `<input id="ends_at" type="date" value="${esc(p.ends_at || '')}">`, 'si plusieurs jours')}
          ${field('Où', select('location_kind', Object.entries(LOCATION_KINDS), p.location_kind))}
          ${field('Lieu précis', `<input id="location" value="${esc(p.location || '')}" placeholder="Salle 204 bât. Pitié, amphi B, foyer…">`)}
          ${field('Public visé', `<input id="audience" value="${esc(p.audience || '')}" placeholder="PASS/LAS de l'antenne, externes DFASM, tous membres IDF…">`)}
          ${field('Participants attendus', `<input id="expected" type="number" min="0" value="${esc(p.expected ?? '')}">`)}
          ${field('En une ou deux phrases', `<textarea id="summary" placeholder="Ce qu'on fait, pour qui, pourquoi.">${esc(p.summary || '')}</textarea>`).replace('<label>', '<label class="wide">')}
          <label class="wide">Co-porteurs <span class="hint">(facultatif)</span><select id="members" multiple size="4">${people.filter((x) => x.id !== me.person?.id).map((x) => `<option value="${x.id}" ${members.includes(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        </div>
        <label class="check" style="margin-top:16px"><input type="checkbox" id="full" ${full ? 'checked' : ''}> <span><b>Ce projet demande un budget, des moyens ou engage la localité</b><br><small class="muted">Argent, matériel, salle hors fac, intervenant ou partenaire extérieur, communication publique.</small></span></label>
      </div>

      <div class="panel" id="full-part" ${full ? '' : 'hidden'}>
        <h2>Budget et moyens</h2>
        ${field('Objectif et lien avec le plan d\'action', `<textarea id="objective" placeholder="À quoi sert ce projet, quel résultat on attend.">${esc(p.objective || '')}</textarea>`)}
        <h3>Dépenses prévues</h3>
        <div class="table-wrap"><table class="budget"><thead><tr><th>Poste de dépense</th><th class="num">Montant</th><th>Mode de paiement</th><th></th></tr></thead><tbody id="dep"></tbody>
          <tfoot><tr class="tot"><td>Total dépenses</td><td class="num" id="tot-dep"></td><td colspan="2"></td></tr></tfoot></table></div>
        <button type="button" class="small" id="add-dep" style="margin-top:8px">+ Ligne de dépense</button>
        <h3>Recettes attendues <span class="hint muted">(billetterie, participation, subvention fléchée)</span></h3>
        <div class="table-wrap"><table class="budget"><thead><tr><th>Source</th><th class="num">Montant</th><th></th></tr></thead><tbody id="rec"></tbody>
          <tfoot><tr class="tot"><td>Total recettes</td><td class="num" id="tot-rec"></td><td></td></tr></tfoot></table></div>
        <button type="button" class="small" id="add-rec" style="margin-top:8px">+ Ligne de recette</button>
        <h3>Ce que le projet engage</h3>
        <div class="flags">
          ${[['needs_room', 'Une salle à réserver par la localité', 'hors des salles que l\'antenne obtient elle-même'], ['needs_material', 'Du matériel de la localité', 'sono, vidéoprojecteur, stands, kakémonos…'], ['needs_com', 'Un relais de communication interne', 'réseaux et canaux OMAS'],
    ['external_speaker', 'Un intervenant extérieur à l\'OMAS', 'professionnel, imam, enseignant, association'], ['external_com', 'Une communication publique', 'affiches, réseaux publics, presse, hors des canaux membres'], ['partner', 'Un partenaire ou une convention', 'association, entreprise, institution, mosquée'],
    ['national', 'Plusieurs localités ou le national', 'remonte au bureau national']].map(([k, l, h]) => `<label class="check"><input type="checkbox" id="${k}" ${p[k] ? 'checked' : ''}> <span>${l}<small>${h}</small></span></label>`).join('')}
        </div>
        <div class="form-grid" style="margin-top:10px">
          ${field('Intervenants, partenaires, communication publique : le détail', `<textarea id="details" placeholder="Qui, quelle structure, défraiement ou non, ce qui sera dit ou affiché publiquement.">${esc(p.details || '')}</textarea>`).replace('<label>', '<label class="wide">')}
          ${field('Risques et assurance', `<textarea id="risks" placeholder="Déplacement, nourriture, mineurs, activité physique, sécurité du lieu… et ce qui est prévu.">${esc(p.risks || '')}</textarea>`).replace('<label>', '<label class="wide">')}
          ${field('Lancement de la communication', `<input id="plan_com" type="date" value="${esc(p.plan_com || '')}">`)}
          ${field('Confirmation logistique (lieu, matériel)', `<input id="plan_logi" type="date" value="${esc(p.plan_logi || '')}">`)}
        </div>
      </div>

      <div id="level-box"></div>

      <div class="row" style="margin-top:18px">
        <button type="submit" class="primary" data-act="save">${id ? 'Enregistrer' : 'Enregistrer le brouillon'}</button>
        ${!data || data.can.canSubmit ? '<button type="submit" data-act="submit">Enregistrer et déposer</button>' : ''}
        <span class="spacer"></span><span class="save-state muted small" id="miss"></span>
      </div>
      </form>`;

    const levelBox = () => {
      const lv = computeLevel({ ...p, ...(full ? {} : { external_speaker: 0, external_com: 0, partner: 0, needs_material: 0, national: 0 }) }, full ? lines : [], rules);
      const rs = levelReasons(p, full ? lines : [], rules); const st = stepsForLevel(lv);
      app.querySelector('#level-box').innerHTML = `<div class="level-box"><div class="n">${lv}</div><div><div class="t">${esc(LEVEL_LABELS[lv])}</div>
        <div class="why">${rs.length ? `Parce que : ${esc(rs.join(', '))}.` : 'Pas de budget ni d\'engagement : validation en un clic par ton responsable.'}
        Circuit : ${st.map((s) => esc(STEP_LABELS[s])).join(' puis ')}. Délai de réponse : ${delayDays(lv, rules)} jours, puis remontée automatique.</div></div></div>`;
    };
    levelBox();
    const dep = app.querySelector('#dep'); const rec = app.querySelector('#rec');
    const drawLines = () => {
      const ds = lines.filter((l) => l.kind !== 'recette'); const rs = lines.filter((l) => l.kind === 'recette');
      dep.innerHTML = ds.map((l) => `<tr data-i="${lines.indexOf(l)}"><td><input class="l-label" value="${esc(l.label)}" placeholder="Goûter, impression d'affiches, location de salle…"></td><td class="num"><input class="l-amount" type="number" min="0" step="0.01" value="${l.amount || ''}" style="width:110px;text-align:right"></td>
        <td>${select('', PAYMENTS, l.payment, { empty: 'Mode de paiement…' }).replace('id=""', 'class="l-pay"')}</td><td><button type="button" class="small quiet l-del" aria-label="Supprimer">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted small">Aucune dépense pour l\'instant.</td></tr>';
      rec.innerHTML = rs.map((l) => `<tr data-i="${lines.indexOf(l)}"><td><input class="l-label" value="${esc(l.label)}" placeholder="Billetterie, participation 2 €…"></td><td class="num"><input class="l-amount" type="number" min="0" step="0.01" value="${l.amount || ''}" style="width:110px;text-align:right"></td><td><button type="button" class="small quiet l-del" aria-label="Supprimer">✕</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted small">Aucune recette.</td></tr>';
      app.querySelector('#tot-dep').textContent = money(sumLines(lines, 'depense')); app.querySelector('#tot-rec').textContent = money(sumLines(lines, 'recette'));
      app.querySelectorAll('tr[data-i]').forEach((tr) => {
        const l = lines[Number(tr.dataset.i)];
        tr.querySelector('.l-label').oninput = (e) => { l.label = e.target.value; };
        tr.querySelector('.l-amount').oninput = (e) => { l.amount = Number(e.target.value) || 0; app.querySelector('#tot-dep').textContent = money(sumLines(lines, 'depense')); app.querySelector('#tot-rec').textContent = money(sumLines(lines, 'recette')); levelBox(); };
        tr.querySelector('.l-pay')?.addEventListener('change', (e) => { l.payment = e.target.value || null; });
        tr.querySelector('.l-del').onclick = () => { lines.splice(lines.indexOf(l), 1); collect(); draw(); };
      });
    };
    drawLines();
    app.querySelector('#add-dep').onclick = () => { collect(); lines.push({ kind: 'depense', label: '', amount: 0, payment: null }); draw(); };
    app.querySelector('#add-rec').onclick = () => { collect(); lines.push({ kind: 'recette', label: '', amount: 0, payment: null }); draw(); };
    app.querySelector('#full').onchange = (e) => { collect(); full = e.target.checked; draw(); };
    // le niveau se recalcule quand un champ qui compte change
    ['location_kind', 'needs_material', 'external_speaker', 'external_com', 'partner', 'national', 'needs_room', 'needs_com'].forEach((k) => { const el = app.querySelector(`#${k}`); if (el) el.onchange = () => { collect(); levelBox(); }; });
    app.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const act = e.submitter?.dataset.act || 'save';
      collect();
      try {
        const body = { ...p, lines: full ? lines : [], members };
        if (!full) Object.assign(body, { needs_room: 0, needs_material: 0, needs_com: 0, external_speaker: 0, external_com: 0, partner: 0, national: 0 });
        let pid = id;
        if (id) await api(`/projects/${id}`, { method: 'PUT', body }); else pid = (await api('/projects', { method: 'POST', body })).id;
        if (act === 'submit') {
          const lvl = computeLevel(body, body.lines, rules);
          const miss = missingFields(body, body.lines, lvl);
          if (miss.length) { toast(`Avant de déposer, il manque ${miss.join(', ')}.`, 'error'); if (!id) { location.hash = `#/projet/${pid}/modifier`; } return; }
          const r = await api(`/projects/${pid}/submit`, { method: 'POST' });
          toast(`Projet déposé (niveau ${r.level}). Les valideurs sont prévenus.`);
        } else toast('Enregistré');
        location.hash = `#/projet/${pid}`;
      } catch (err) { toast(err.message, 'error'); }
    };
  };
  const collect = () => {
    const r = app;
    for (const k of ['title', 'type', 'unit_id', 'domain', 'owner_post_id', 'starts_at', 'start_time', 'ends_at', 'location_kind', 'location', 'audience', 'expected', 'summary', 'objective', 'details', 'risks', 'plan_com', 'plan_logi']) {
      if (r.querySelector(`#${k}`)) p[k] = val(r, k) === '' ? null : val(r, k);
    }
    for (const k of ['needs_room', 'needs_material', 'needs_com', 'external_speaker', 'external_com', 'partner', 'national']) if (r.querySelector(`#${k}`)) p[k] = chk(r, k) ? 1 : 0;
    members = [...(r.querySelector('#members')?.selectedOptions || [])].map((o) => Number(o.value));
  };
  draw();
}

// ---------- consultation ----------
export async function projectView(app, id) {
  const d = await api(`/projects/${id}`);
  const { project: p, lines, approvals, events, members, can, rules, spend, income } = d;
  setTitle(p.title);
  const me = state.me;
  const lastRound = Math.max(0, ...approvals.map((a) => a.round));
  const current = approvals.filter((a) => a.round === lastRound);
  const stepName = (a) => `${STEP_LABELS[a.step] || a.step}${a.comment?.startsWith('Escalade') ? ' · escalade' : ''}`;
  const decisionLabel = { pending: 'En attente', ok: 'Validé', refuse: 'Refusé', ajourne: 'Ajourné', complement: 'Complément demandé', void: 'Sans objet' };

  const flags = [['needs_room', 'salle à réserver par la localité'], ['needs_material', 'matériel de la localité'], ['needs_com', 'relais de communication interne'], ['external_speaker', 'intervenant extérieur'], ['external_com', 'communication publique'], ['partner', 'partenaire ou convention'], ['national', 'plusieurs localités ou national']].filter(([k]) => p[k]).map(([, l]) => l);

  app.innerHTML = `
    <a class="back" href="#/">← Mon espace</a>
    <div class="hero">
      <div>${p.code ? `<span class="code">${esc(p.code)}</span>` : `<span class="code">Pas encore de code : attribué à la validation</span>`}<h1>${esc(p.title)}</h1>
        <div class="meta"><b>${esc(longDate(p.starts_at))}${p.start_time ? ` à ${esc(p.start_time)}` : ''}${p.ends_at && p.ends_at !== p.starts_at ? ` → ${esc(longDate(p.ends_at))}` : ''}</b> · ${esc(p.location || LOCATION_KINDS[p.location_kind])} · ${esc(p.unit_name)}<br>
        Porté par <b>${esc(p.owner_name)}</b>${p.owner_post_label ? ` (${esc(p.owner_post_label)})` : ''}${members.length ? ` avec ${members.map((m) => esc(m.name)).join(', ')}` : ''}</div></div>
      <div class="stack" style="text-align:right">${statusPill(p.status)}<br>${levelPill(p.level)} ${domainPill(p.domain)}<br><span class="small">${esc(TYPES[p.type] || p.type)}</span></div>
    </div>
    ${p.decision_note && ['refuse', 'complement', 'ajourne', 'abandonne'].includes(p.status) ? `<div class="alert ${p.status === 'refuse' ? 'error' : 'warn'}"><b>${esc(decisionLabel[p.status] || p.status)}${p.postponed_to ? ` jusqu'au ${esc(longDate(p.postponed_to))}` : ''}.</b> ${esc(p.decision_note)}</div>` : ''}
    ${p.status === 'depose' && p.due_at ? `<div class="alert info">En instruction depuis le ${esc(dateTime(p.submitted_at))}. Réponse attendue avant le ${esc(dateTime(p.due_at))} (${daysLeft(p.due_at)} j), sinon remontée automatique.</div>` : ''}

    <div class="row" id="actions">
      ${can.canEdit || can.canEditValidated ? `<a class="btn" href="#/projet/${p.id}/modifier">Modifier</a>` : ''}
      ${can.canSubmit && p.status !== 'depose' ? `<button class="primary" data-a="submit">${p.status === 'brouillon' ? 'Déposer pour validation' : 'Redéposer'}</button>` : ''}
      ${can.canRealize ? '<button class="primary" data-a="realize">Marquer comme réalisé</button>' : ''}
      ${can.canClose ? '<button data-a="close">Clôturer</button>' : ''}
      ${can.canAbandon && !['brouillon'].includes(p.status) ? '<button class="quiet danger" data-a="abandon">Abandonner</button>' : ''}
      ${can.canAbandon && p.status === 'brouillon' ? '<button class="quiet danger" data-a="abandon">Supprimer le brouillon</button>' : ''}
    </div>

    ${can.canDecide.length && p.status === 'depose' ? `<div class="panel" style="border-color:var(--a)"><h2>Ta décision</h2>
      <p class="muted small">Tu te prononces en tant que ${[...new Set(current.filter((a) => can.canDecide.includes(a.id)).map((a) => a.post_label))].map(esc).join(', ')}. Pour refuser, ajourner ou demander un complément, un motif en une phrase est obligatoire et sera lu par le porteur.</p>
      <div class="decide"><button class="primary" data-d="ok">Valider</button><button data-d="complement">Demander un complément</button><button data-d="ajourne">Ajourner</button><button class="danger" data-d="refuse">Refuser</button></div></div>` : ''}

    <div class="grid cols-2">
      <div class="panel"><h2>La fiche</h2>
        <dl class="kv">
          <dt>Public</dt><dd>${esc(p.audience || '')}${p.expected ? ` · ${p.expected} personnes attendues` : ''}</dd>
          <dt>Description</dt><dd class="pre">${esc(p.summary || '')}</dd>
          ${p.objective ? `<dt>Objectif</dt><dd class="pre">${esc(p.objective)}</dd>` : ''}
          ${flags.length ? `<dt>Engage</dt><dd>${esc(flags.join(', '))}</dd>` : ''}
          ${p.details ? `<dt>Détail</dt><dd class="pre">${esc(p.details)}</dd>` : ''}
          ${p.risks ? `<dt>Risques et assurance</dt><dd class="pre">${esc(p.risks)}</dd>` : ''}
          ${p.plan_com || p.plan_logi ? `<dt>Jalons</dt><dd>${p.plan_com ? `Communication : ${esc(longDate(p.plan_com))}` : ''}${p.plan_com && p.plan_logi ? '<br>' : ''}${p.plan_logi ? `Logistique confirmée : ${esc(longDate(p.plan_logi))}` : ''}</dd>` : ''}
          <dt>Exercice</dt><dd>${esc(p.exercise.slice(0, 2))}-${esc(p.exercise.slice(2))} · créé le ${esc(dateTime(p.created_at))}</dd>
        </dl>
      </div>
      <div class="panel"><h2>Budget</h2>
        ${lines.length ? `<div class="table-wrap"><table><thead><tr><th>Ligne</th><th class="num">Montant</th><th>Paiement</th></tr></thead><tbody>
          ${lines.filter((l) => l.kind !== 'recette').map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${money(l.amount)}</td><td class="small muted">${esc(PAYMENTS.find((x) => x[0] === l.payment)?.[1] || '')}</td></tr>`).join('')}
          <tr class="tot"><td><b>Dépenses</b></td><td class="num"><b>${money(spend)}</b></td><td></td></tr>
          ${lines.filter((l) => l.kind === 'recette').map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${money(l.amount)}</td><td class="small muted">recette</td></tr>`).join('')}
          ${income ? `<tr class="tot"><td><b>Recettes</b></td><td class="num"><b>${money(income)}</b></td><td></td></tr><tr><td>Reste à charge</td><td class="num">${money(spend - income)}</td><td></td></tr>` : ''}
        </tbody></table></div>` : '<p class="muted">Projet sans budget.</p>'}
        ${p.code ? `<p class="small muted" style="margin-top:12px">Chaque dépense, note de frais et support de com porte le code <span class="code">${esc(p.code)}</span>.</p>` : ''}
      </div>
    </div>

    <div class="panel"><h2>Circuit de validation</h2>
      ${approvals.length ? `<p class="muted small">Niveau ${p.level} : ${esc(LEVEL_LABELS[p.level])}. Étapes : ${stepsForLevel(p.level).map((s) => esc(STEP_LABELS[s])).join(', ')}${stepsForLevel(p.level).includes('bureau') ? ` (bureau : ${rules.quorum} voix suffisent)` : ''}.</p>
      <div class="circuit">${current.map((a) => `<div class="ap ${esc(a.decision)}"><div class="dot"></div><div><b>${esc(a.post_label || stepName(a))}</b> <span class="small muted">· ${esc(stepName(a))}</span><div class="who">${a.holders?.length ? esc(a.holders.join(', ')) : '<span style="color:var(--ko)">poste vacant</span>'}</div>${a.comment && a.decision !== 'pending' ? `<div class="cmt">${esc(a.comment)}</div>` : ''}${a.comment?.startsWith('Escalade') ? `<div class="cmt">${esc(a.comment)}</div>` : ''}</div>
        <div class="small" style="text-align:right">${esc(decisionLabel[a.decision] || a.decision)}${a.decider_name ? `<br><span class="muted">${esc(a.decider_name)}, ${esc(dateTime(a.decided_at))}</span>` : a.decision === 'pending' && a.due_at ? `<br><span class="muted">avant le ${esc(dateTime(a.due_at))}</span>` : ''}</div></div>`).join('')}</div>
      ${lastRound > 1 ? `<p class="small muted" style="margin-top:10px">Tour ${lastRound} : les tours précédents figurent dans l'historique.</p>` : ''}`
    : '<p class="muted">Le circuit apparaît au dépôt. Il dépend du budget et de ce que le projet engage.</p>'}
    </div>

    <div class="panel"><h2>Historique et échanges</h2>
      <ul class="timeline">${events.map((e) => {
    const det = e.detail ? JSON.parse(e.detail) : {};
    const labels = { cree: 'a créé la fiche', depose: `a déposé le projet (niveau ${det.level ?? ''})`, decision_ok: 'a validé', decision_refuse: 'a refusé', decision_ajourne: 'a ajourné', decision_complement: 'a demandé un complément', valide: `Projet validé, code ${det.code || ''}`, escalade: `Escalade automatique : ${det.from || ''} → ${det.to || ''}`, abandonne: 'a abandonné le projet', realise: 'a marqué le projet comme réalisé', cloture: 'a clôturé le projet', commentaire: '', modifie_admin: 'a modifié la fiche après validation' };
    const cls = e.kind.startsWith('decision_ok') || e.kind === 'valide' || e.kind === 'depose' ? 'approve' : e.kind.includes('refuse') || e.kind === 'abandonne' ? 'refuse' : '';
    return `<li class="${cls}"><span class="who">${esc(e.name || 'Système')}</span> ${esc(labels[e.kind] ?? e.kind)} <span class="when">· ${esc(dateTime(e.at))}</span>${det.comment || det.body ? `<div class="comment">${nl(det.body || det.comment)}</div>` : ''}</li>`;
  }).join('')}</ul>
      ${can.canComment ? '<form id="cf" class="row" style="margin-top:12px"><input id="cbody" placeholder="Un message pour le porteur ou les valideurs…" style="flex:1" maxlength="2000"><button class="small">Envoyer</button></form>' : ''}
    </div>`;

  const act = async (a) => {
    try {
      if (a === 'submit') { const r = await api(`/projects/${id}/submit`, { method: 'POST' }); toast(`Déposé : niveau ${r.level}, réponse attendue sous ${delayDays(r.level, rules)} jours.`); }
      if (a === 'realize') { await api(`/projects/${id}/realize`, { method: 'POST' }); toast('Marqué comme réalisé. Pense au bilan.'); }
      if (a === 'close') { const r = await ask({ title: 'Clôturer ce projet', text: 'À faire une fois les dépenses rapprochées et le bilan reçu.', placeholder: 'Remarque (facultatif)…', label: 'Clôturer' }); if (!r) return; await api(`/projects/${id}/close`, { method: 'POST', body: { comment: r.text } }); }
      if (a === 'abandon') { const r = await ask({ title: p.status === 'brouillon' ? 'Supprimer ce brouillon ?' : 'Abandonner ce projet ?', placeholder: 'Pourquoi (une phrase)…', label: 'Confirmer', danger: true }); if (!r) return; await api(`/projects/${id}/abandon`, { method: 'POST', body: { comment: r.text } }); }
      projectView(app, id);
    } catch (err) { toast(err.message, 'error'); if (err.message.includes('manque')) location.hash = `#/projet/${id}/modifier`; }
  };
  app.querySelectorAll('#actions [data-a]').forEach((b) => b.addEventListener('click', () => act(b.dataset.a)));
  app.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    const dcs = b.dataset.d;
    let body = { decision: dcs };
    if (dcs !== 'ok') {
      const r = await ask({ title: { refuse: 'Refuser le projet', ajourne: 'Ajourner la décision', complement: 'Demander un complément' }[dcs], placeholder: 'Motif en une phrase, lu par le porteur…', label: 'Envoyer', danger: dcs === 'refuse', date: dcs === 'ajourne', dateLabel: 'Reporter la décision au' });
      if (!r) return;
      body = { ...body, comment: r.text, postponed_to: r.date };
    } else if (!(await ask({ title: 'Valider ce projet ?', text: spend ? `Tu engages ${money(spend)} de budget.` : 'Projet sans budget.', label: 'Valider' }))) return;
    try { const r = await api(`/projects/${id}/decide`, { method: 'POST', body }); toast(r.status === 'valide' ? 'Projet validé, le porteur est prévenu.' : r.status === 'depose' ? 'Décision enregistrée, d\'autres validations sont attendues.' : 'Décision enregistrée.'); projectView(app, id); } catch (err) { toast(err.message, 'error'); }
  }));
  app.querySelector('#cf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/projects/${id}/comments`, { method: 'POST', body: { body: app.querySelector('#cbody').value } }); projectView(app, id); } catch (err) { toast(err.message, 'error'); }
  });
}
