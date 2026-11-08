// Données de démonstration, fictives, pour une base locale : personnes, postes, projets à tous les stades.
// Usage : npm run dev dans un terminal, puis node scripts/demo/seed.mjs (ADMIN_PASSWORD=test-admin et DEV_LINKS=1 dans .dev.vars).
const BASE = process.env.BASE || 'http://localhost:8788';
const PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin';

class Client {
  constructor() { this.cookie = ''; }
  async call(path, method = 'GET', body) {
    const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, origin: BASE }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${data?.error || ''}`);
    return data;
  }
}

const admin = new Client();
await admin.call('/auth/admin', 'POST', { password: PASSWORD });
const org = await admin.call('/org');
const post = (unitCode, code, domain) => org.posts.find((p) => org.units.find((u) => u.id === p.unit_id)?.code === unitCode && p.code === code && (domain === undefined || p.domain === domain));

// Personnes fictives (prénoms inventés, adresses @exemple.org : jamais envoyées)
const PEOPLE = [
  ['Yacine Belkacem', 'IDF', 'manager'], ['Sofia Haddad', 'IDF', 'secretaire', null, true], ['Ismaïl Touré', 'IDF', 'tresorier'], ['Leïla Benali', 'IDF', 'vm_etudiants'], ['Karim Ouali', 'IDF', 'vm_internes'],
  ['Nour Chérif', 'IDF', 'resp_pole', 'SAV'], ['Adam Saïdi', 'IDF', 'resp_pole', 'SOL'], ['Hana Mezhoud', 'IDF', 'resp_pole', 'COM'], ['Omar Diallo', 'IDF', 'resp_pole', 'DEV'],
  ['Lokmann Hamidi', 'UPC', 'referent_antenne'], ['Rayhane Sahli', 'UPC', 'delegue_pole', 'SAV'], ['Dina Mansouri', 'UPC', 'delegue_pole', 'SOL'],
  ['Isaac Meziane', 'UPEC', 'referent_antenne'], ['Abdelmalek Slimani', 'UPEC', 'delegue_pole', 'SAV'], ['Amine Harrach', 'UPEC', 'delegue_pole', 'LOG'], ['Mariame Ndiaye', 'UPEC', 'delegue_pole', 'COM'],
  ['Fatima Hachemi', 'SPN', 'referent_antenne'], ['Selwa Bouzid', 'SPN', 'delegue_pole', 'SAV'], ['Imane Essafi', 'SPN', 'delegue_pole', 'LOG'],
  ['Dalia Rahmani', 'SU', 'delegue_pole', 'LOG'], ['Yousra Chaabane', 'SU', 'delegue_pole', 'PRP'],
];
const people = {};
for (const [name, unit, code, domain, isAdmin] of PEOPLE) {
  const email = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.')}@exemple.org`;
  let id;
  try { id = (await admin.call('/admin/people', 'POST', { name, email, is_admin: !!isAdmin })).id; } catch { id = (await admin.call('/admin/people')).find((p) => p.email === email).id; }
  const p = post(unit, code, domain ?? undefined);
  if (!p) throw new Error(`poste introuvable ${unit} ${code} ${domain}`);
  await admin.call('/admin/assign', 'POST', { person_id: id, post_id: p.id });
  people[name] = id;
}
console.log(`${PEOPLE.length} personnes en poste`);

async function as(name) {
  const c = new Client();
  const { url } = await admin.call(`/admin/people/${people[name]}/link`, 'POST', { send: false });
  await c.call('/auth/consume', 'POST', { token: url.split('/connexion/')[1] });
  return c;
}
const d = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const unit = (code) => org.units.find((u) => u.code === code).id;

const PROJECTS = [
  // [porteur, fiche, lignes, scénario]
  ['Rayhane Sahli', { title: 'Séance de tutorat PASS : biochimie', type: 'tutorat', unit_id: unit('UPC'), domain: 'SAV', starts_at: d(6), start_time: '18:00', location: 'Salle 204, site des Cordeliers', audience: 'PASS/LAS UPC', expected: 25, summary: 'Révision du chapitre enzymes avec QCM corrigés en direct.' }, [], 'valide'],
  ['Rayhane Sahli', { title: 'Séance de tutorat PASS : anatomie', type: 'tutorat', unit_id: unit('UPC'), domain: 'SAV', starts_at: d(13), start_time: '18:00', location: 'Salle 204, site des Cordeliers', audience: 'PASS/LAS UPC', expected: 25, summary: 'Membre supérieur, schémas au tableau.' }, [], 'depose'],
  ['Dina Mansouri', { title: 'Petit-déjeuner solidaire de rentrée', type: 'accueil', unit_id: unit('UPC'), domain: 'SOL', starts_at: d(9), start_time: '08:00', location: 'Hall de la fac, Bichat', audience: 'Tous étudiants de l\'antenne', expected: 80, summary: 'Accueil des nouveaux, café et viennoiseries, présentation de l\'OMAS.', objective: 'Recruter une dizaine de nouveaux membres et faire connaître le tutorat.', plan_logi: d(5) },
    [{ kind: 'depense', label: 'Viennoiseries et boissons', amount: 120, payment: 'carte' }, { kind: 'depense', label: 'Impression de flyers', amount: 35, payment: 'remboursement' }], 'depose'],
  ['Abdelmalek Slimani', { title: 'Conférence : éthique et fin de vie', type: 'conference', unit_id: unit('UPEC'), domain: 'ETH', starts_at: d(32), start_time: '19:00', location: 'Amphi 2, faculté de santé de Créteil', audience: 'Étudiants et internes IDF', expected: 120, summary: 'Table ronde avec un médecin de soins palliatifs et un aumônier hospitalier.', objective: 'Ouvrir la réflexion éthique sur la fin de vie à partir de cas réels.', details: 'Dr X (soins palliatifs, Henri-Mondor) et un aumônier musulman de l\'AP-HP, sans défraiement. Affiches sur les campus et publication sur le compte Instagram public.', risks: 'Aucun risque particulier. Salle de la fac, assurance de la faculté.', plan_com: d(10), plan_logi: d(20), external_speaker: 1, external_com: 1 },
    [{ kind: 'depense', label: 'Collation de fin', amount: 180, payment: 'carte' }, { kind: 'depense', label: 'Affiches A3 et kakémono', amount: 90, payment: 'virement' }, { kind: 'depense', label: 'Cadeaux intervenants', amount: 60, payment: 'remboursement' }], 'depose'],
  ['Amine Harrach', { title: 'Sortie cohésion : accrobranche', type: 'sortie', unit_id: unit('UPEC'), domain: 'VIE', starts_at: d(40), start_time: '10:00', location: 'Parc de loisirs, 77', location_kind: 'hors_fac', audience: 'Membres actifs UPEC', expected: 30, summary: 'Journée de cohésion de l\'équipe d\'antenne et des tuteurs.', objective: 'Souder l\'équipe avant le second semestre.', risks: 'Activité physique : décharge signée, encadrement du parc. Transport en RER.', plan_logi: d(25) },
    [{ kind: 'depense', label: 'Entrées (30 x 22 €)', amount: 660, payment: 'virement' }, { kind: 'recette', label: 'Participation 10 € par personne', amount: 300 }], 'brouillon'],
  ['Selwa Bouzid', { title: 'Concours blanc PASS n°1', type: 'tutorat', unit_id: unit('SPN'), domain: 'SAV', starts_at: d(-20), start_time: '09:00', location: 'Amphi 1, Bobigny', audience: 'PASS/LAS SPN', expected: 90, summary: 'Premier concours blanc de l\'année, 4 h, correction la semaine suivante.', objective: 'Mettre les PASS en conditions réelles.', plan_logi: d(-25) },
    [{ kind: 'depense', label: 'Impression des sujets', amount: 210, payment: 'remboursement' }], 'realise'],
  ['Imane Essafi', { title: 'Soirée rappel : les 40 hadiths', type: 'spirituel', unit_id: unit('SPN'), domain: 'ETH', starts_at: d(-45), start_time: '19:30', location: 'Salle polyvalente, Bobigny', audience: 'Tous membres', expected: 40, summary: 'Soirée mensuelle, lecture commentée.' }, [], 'cloture'],
  ['Yousra Chaabane', { title: 'Permanence PRP du mercredi', type: 'tutorat', unit_id: unit('SU'), domain: 'PRP', starts_at: d(3), start_time: '12:30', location: 'BU Pitié, salle de groupe', audience: 'PASS/LAS SU', expected: 12, summary: 'Questions-réponses hebdomadaire avec les tuteurs.' }, [], 'valide'],
  ['Nour Chérif', { title: 'Formation des tuteurs IDF', type: 'atelier', unit_id: unit('IDF'), domain: 'SAV', starts_at: d(21), start_time: '14:00', location: 'Salle associative, Paris 13e', location_kind: 'hors_fac', audience: 'Tuteurs des quatre antennes', expected: 45, summary: 'Après-midi de formation : pédagogie, posture, outils communs.', objective: 'Homogénéiser l\'accompagnement entre antennes.', plan_logi: d(14), needs_material: 1 },
    [{ kind: 'depense', label: 'Location de salle', amount: 150, payment: 'virement' }, { kind: 'depense', label: 'Goûter', amount: 70, payment: 'carte' }], 'depose'],
  ['Dina Mansouri', { title: 'Maraude du mois', type: 'prevention', unit_id: unit('UPC'), domain: 'SOL', starts_at: d(17), start_time: '20:00', location: 'Départ gare du Nord', audience: 'Bénévoles de l\'antenne', expected: 15, summary: 'Distribution de repas chauds et de kits d\'hygiène avec une association partenaire.' }, [], 'refuse'],
];

const sup = (n) => people[n] && n;
for (const [owner, fiche, lines, scenario] of PROJECTS) {
  const c = await as(owner);
  const { id } = await c.call('/projects', 'POST', { ...fiche, lines });
  if (scenario === 'brouillon') continue;
  if (fiche.starts_at < d(0)) {
    // régularisation d'un projet passé : l'admin dépose
    await admin.call(`/projects/${id}`, 'PUT', {});
  }
  const submitter = fiche.starts_at < d(0) ? admin : c;
  await submitter.call(`/projects/${id}/submit`, 'POST');
  if (scenario === 'depose') continue;
  const full = await admin.call(`/projects/${id}`);
  const pending = full.approvals.filter((a) => a.decision === 'pending');
  for (const a of pending) {
    const holder = org.holders?.find?.((h) => h.post_id === a.post_id);
    // on trouve la personne qui tient le poste via l'organigramme rafraîchi
    const o2 = await admin.call('/org');
    const h = o2.holders.find((x) => x.post_id === a.post_id);
    if (!h) continue;
    const name = Object.keys(people).find((n) => people[n] === h.person_id);
    const v = await as(name);
    if (scenario === 'refuse') { await v.call(`/projects/${id}/decide`, 'POST', { decision: 'refuse', comment: 'L\'association partenaire n\'est pas identifiée et aucune convention n\'existe : à représenter avec le partenaire nommé.' }); break; }
    await v.call(`/projects/${id}/decide`, 'POST', { decision: 'ok', approval_id: a.id });
    const st = (await admin.call(`/projects/${id}`)).project.status;
    if (st !== 'depose') break;
  }
  if (['realise', 'cloture'].includes(scenario)) await c.call(`/projects/${id}/realize`, 'POST');
  if (scenario === 'cloture') { const t = await as('Ismaïl Touré'); await t.call(`/projects/${id}/close`, 'POST', { comment: 'Sans dépense.' }); }
}
const all = await admin.call('/projects?scope=all');
console.log(`${all.length} projets :`, Object.entries(all.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('Connexion de test :');
for (const n of ['Sofia Haddad', 'Lokmann Hamidi', 'Rayhane Sahli', 'Ismaïl Touré']) console.log(` ${n} → ${(await admin.call(`/admin/people/${people[n]}/link`, 'POST', { send: false })).url}`);

// ---------- demandes entre responsables ----------
// un poste de filière Psychologie (absent de l'organigramme IDF de départ) et deux responsables de plus
const psyPost = (await admin.call('/admin/posts', 'POST', { unit_id: unit('IDF'), code: 'resp_filiere', label: 'Responsable filière Psychologie IDF', domain: 'PSY', parent_id: post('IDF', 'manager').id })).id;
const extra = [['Inès Kaci', post('IDF', 'resp_filiere', 'MED').id], ['Samir Aït-Ali', psyPost]];
for (const [name, postId] of extra) {
  const email = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.')}@exemple.org`;
  const id = (await admin.call('/admin/people', 'POST', { name, email })).id;
  await admin.call('/admin/assign', 'POST', { person_id: id, post_id: postId });
  people[name] = id;
}
const ines = await as('Inès Kaci');
const sm = (await ines.call('/projects', 'POST', { title: 'Journée santé mentale des externes', type: 'prevention', unit_id: unit('IDF'), domain: 'MED', starts_at: d(26), start_time: '13:30', location: 'Faculté de santé, site Bichat', audience: 'Externes DFASM des quatre antennes', expected: 60, summary: 'Après-midi d’échanges sur la santé mentale pendant l’externat, avec des consultations individuelles proposées par des psychologues de l’OMAS.', objective: 'Faire connaître les ressources d’écoute et lever le tabou de la souffrance en stage.', plan_com: d(12), plan_logi: d(19), lines: [{ kind: 'depense', label: 'Collation', amount: 120, payment: 'carte' }] })).id;
await ines.call(`/projects/${sm}/submit`, 'POST');
const o3 = await admin.call('/org');
const psyHolder = o3.holders.find((h) => h.post_id === psyPost);
const solPost = post('IDF', 'resp_pole', 'SOL').id;
const comPost = post('IDF', 'resp_pole', 'COM').id;
const { ids } = await ines.call('/requests', 'POST', { to_post_ids: [psyPost], kind: 'collaboration', project_id: sm, subject: 'Journée santé mentale : des psychologues pour les consultations', body: 'Bonjour Samir,\nJe prépare avec la filière médecine une après-midi sur la santé mentale des externes, le jeudi indiqué sur la fiche. On aimerait proposer des consultations individuelles de 20 minutes.\nEst-ce que la filière psychologie pourrait mobiliser trois ou quatre psychologues ? On s’occupe de la salle et de la communication.' });
await ines.call('/requests', 'POST', { to_post_ids: [solPost], kind: 'info', project_id: sm, subject: 'Journée santé mentale des externes', body: 'Pour info : on organise une après-midi santé mentale pour les externes. Si le pôle Solidarités a des ressources d’écoute à présenter, tu es le bienvenu.' });
const samir = await as('Samir Aït-Ali');
await samir.call(`/requests/${ids[0]}/messages`, 'POST', { body: 'Très bonne idée. J’ai trois psychologues partantes. Il faudrait deux salles fermées pour les consultations, c’est possible ?' });
await ines.call(`/requests/${ids[0]}/messages`, 'POST', { body: 'Oui, la fac nous prête deux bureaux à côté de l’amphi. Je te mets en co-organisation sur la fiche.' });
await samir.call(`/requests/${ids[0]}/answer`, 'POST', { status: 'acceptee', body: 'On en est. Je t’envoie les noms d’ici la fin de la semaine.' });
const lok = await as('Lokmann Hamidi');
await lok.call('/requests', 'POST', { to_post_ids: [comPost], kind: 'moyens', subject: 'Affiche pour le petit-déjeuner solidaire', body: 'Salut Hana, est-ce que le pôle Communication peut nous faire une affiche aux couleurs OMAS pour le petit-déjeuner de rentrée à Bichat ? Les infos sont sur la fiche.' });
const nuri = await as('Abdelmalek Slimani');
await nuri.call('/requests', 'POST', { to_post_ids: [psyPost, post('IDF', 'resp_pole', 'ETH').id].filter(Boolean), kind: 'avis', subject: 'Conférence fin de vie : un regard de psychologue ?', body: 'On prépare une conférence sur la fin de vie à Créteil. Un psychologue pourrait-il intervenir sur l’accompagnement des familles ? Votre avis nous intéresse.' }).catch(() => {});
console.log('Demandes créées');
