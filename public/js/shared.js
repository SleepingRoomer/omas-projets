// Logique partagée entre le serveur et le navigateur : niveaux de validation, libellés, codes projet.
// Aucune dépendance : ce fichier est importé tel quel des deux côtés.

export const APP_NAME = 'Cap';
export const LOCALITY = 'OMAS Île-de-France';

export const DEFAULT_RULES = { l1: 150, l2: 500, delays: { 0: 3, 1: 5, 2: 7, 3: 14 }, quorum: 3, exercise_start_month: 9 };

export const DOMAINS = {
  SAV: 'Savoir', ETH: 'Éthique', SOL: 'Solidarités', COM: 'Communication', RES: 'Réseau', DEV: 'Développement',
  PRP: 'PRP', LOG: 'Logistique',
  MED: 'Médecine', PHA: 'Pharmacie', ODO: 'Odontologie', MAI: 'Maïeutique', KIN: 'Kinésithérapie', PSY: 'Psychologie', INF: 'Soins infirmiers',
  INT: 'Internes', PRO: 'Professionnels', VIE: 'Vie de l\'antenne',
};
export const POLE_CODES = ['SAV', 'ETH', 'SOL', 'COM', 'RES', 'DEV', 'PRP', 'LOG'];
export const FILIERE_CODES = ['MED', 'PHA', 'ODO', 'MAI', 'KIN', 'PSY', 'INF'];

export const TYPES = {
  tutorat: 'Tutorat, séance de travail', conference: 'Conférence, table ronde', atelier: 'Atelier, formation', prevention: 'Action de prévention',
  sortie: 'Sortie, cohésion', reunion: 'Réunion, conseil', com: 'Campagne de communication', spirituel: 'Temps spirituel, rappel', accueil: 'Accueil, rentrée',
  autre: 'Autre',
};

export const LOCATION_KINDS = { fac: 'Dans la fac ou le CHU', hors_fac: 'Hors fac (salle louée, extérieur, mosquée, local)', ligne: 'En ligne' };

export const STATUSES = {
  brouillon: { label: 'Brouillon', tone: 'muted' },
  depose: { label: 'En instruction', tone: 'warn' },
  complement: { label: 'Complément demandé', tone: 'warn' },
  valide: { label: 'Validé', tone: 'ok' },
  realise: { label: 'Réalisé', tone: 'ok' },
  cloture: { label: 'Clôturé', tone: 'ink' },
  refuse: { label: 'Refusé', tone: 'ko' },
  ajourne: { label: 'Ajourné', tone: 'warn' },
  abandonne: { label: 'Abandonné', tone: 'muted' },
};
export const OPEN_STATUSES = ['brouillon', 'depose', 'complement', 'valide', 'realise', 'ajourne'];

export const STEP_LABELS = { n1: 'Responsable hiérarchique', tresorier: 'Trésorier', bureau: 'Bureau restreint', n2: 'Escalade (N+2)' };

export const LEVEL_LABELS = {
  0: 'Déclaration simple', 1: 'Petit budget', 2: 'Budget ou moyens de la localité', 3: 'Engagement de la localité', 4: 'National',
};

export const sumLines = (lines, kind = 'depense') => (lines || []).filter((l) => (l.kind || 'depense') === kind).reduce((s, l) => s + (Number(l.amount) || 0), 0);

// Niveau de validation déduit de la fiche. Les seuils viennent des réglages (settings.rules).
export function computeLevel(p, lines, rules = DEFAULT_RULES) {
  const spend = sumLines(lines, 'depense');
  if (p.national) return 4;
  if (spend > rules.l2 || p.external_speaker || p.external_com || p.partner) return 3;
  if (spend > rules.l1 || p.location_kind === 'hors_fac' || p.needs_material) return 2;
  if (spend > 0) return 1;
  return 0;
}

// Raisons lisibles du niveau, pour expliquer au porteur pourquoi sa demande monte
export function levelReasons(p, lines, rules = DEFAULT_RULES) {
  const spend = sumLines(lines, 'depense');
  const r = [];
  if (p.national) r.push('projet multi-localités ou engagement national');
  if (p.partner) r.push('partenaire extérieur');
  if (p.external_speaker) r.push('intervenant extérieur');
  if (p.external_com) r.push('communication publique');
  if (spend > rules.l2) r.push(`budget supérieur à ${rules.l2} €`);
  else if (spend > rules.l1) r.push(`budget supérieur à ${rules.l1} €`);
  else if (spend > 0) r.push('budget demandé');
  if (p.location_kind === 'hors_fac') r.push('lieu hors fac');
  if (p.needs_material) r.push('matériel de la localité');
  return r;
}

// Étapes de validation requises pour un niveau
export function stepsForLevel(level) {
  const s = ['n1'];
  if (level >= 2) s.push('tresorier');
  if (level >= 3) s.push('bureau');
  return s;
}

export const delayDays = (level, rules = DEFAULT_RULES) => Number(rules.delays?.[Math.min(level, 3)] ?? 7);

// Exercice : du 1er septembre au 31 août, écrit « 2627 » pour 2026-2027
export function exerciseFor(dateIso, rules = DEFAULT_RULES) {
  const d = dateIso ? new Date(`${dateIso}T12:00:00Z`) : new Date();
  const y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1;
  const start = m >= (rules.exercise_start_month || 9) ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}
export const exerciseLabel = (ex) => (ex && ex.length === 4 ? `20${ex.slice(0, 2)}-20${ex.slice(2)}` : ex || '');

export const projectCode = (exercise, unitCode, domain, seq) => `${exercise}-IDF-${unitCode}-${domain || 'VIE'}-${String(seq).padStart(3, '0')}`;

// Champs obligatoires selon le niveau
export function missingFields(p, lines, level) {
  const miss = [];
  if (!p.title?.trim()) miss.push('le titre');
  if (!p.unit_id) miss.push('la structure porteuse');
  if (!p.type) miss.push('le type');
  if (!p.starts_at) miss.push('la date');
  if (!p.location?.trim() && p.location_kind !== 'ligne') miss.push('le lieu');
  if (!p.audience?.trim()) miss.push('le public visé');
  if (!p.summary?.trim()) miss.push('la description');
  if (level >= 1) {
    if (!p.objective?.trim()) miss.push('l\'objectif');
    if (!(lines || []).some((l) => (l.kind || 'depense') === 'depense' && l.label?.trim())) miss.push('au moins une ligne de budget');
    if ((lines || []).some((l) => l.label?.trim() && !l.payment)) miss.push('le mode de paiement de chaque ligne');
  }
  if (level >= 2 && !p.plan_logi) miss.push('la date de confirmation logistique');
  if (level >= 3) {
    if (!p.details?.trim()) miss.push('le détail des intervenants, partenaires ou de la communication publique');
    if (!p.risks?.trim()) miss.push('les risques et l\'assurance');
    if (!p.plan_com) miss.push('la date de lancement de la communication');
  }
  return miss;
}

export const money = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

// Demandes entre responsables
export const REQUEST_KINDS = {
  info: 'Pour information', avis: 'Demande d\'avis', collaboration: 'Proposition de collaboration', moyens: 'Demande de moyens ou d\'intervenants', question: 'Question',
};
export const REQUEST_STATUSES = {
  ouverte: { label: 'En attente de réponse', tone: 'warn' }, acceptee: { label: 'Acceptée', tone: 'ok' }, vue: { label: 'Bien noté', tone: 'ok' },
  declinee: { label: 'Déclinée', tone: 'ko' }, close: { label: 'Close', tone: 'muted' },
};

// Planning : éléments générés à partir des projets
export const PLANNING_KINDS = {
  projet: 'Projet', instruction: 'Projet en instruction', com: 'Lancement de la communication', logi: 'Confirmation logistique', bilan: 'Bilan attendu', decision: 'Décision à rendre',
};
export const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
