# Cap : consignes pour travailler sur ce dépôt

Cap est la plateforme des projets d'OMAS Île-de-France : chaque responsable déclare ce qu'il organise (avec ou sans budget), la demande suit un circuit de validation déduit de l'organigramme, le projet validé reçoit un code qui suit chaque dépense jusqu'au bilan. Cadrage complet dans le projet claude.ai « OMAS », document `claude/Projets_plateforme_cadrage_IDF.md`.

## Conventions
- Réponses en français, tutoiement, style naturel, **jamais de tirets cadratins**.
- Commits avec l'auteur « OMAS » : `git -c user.name="OMAS" -c user.email="omas@users.noreply.github.com" commit`.
- Données personnelles (noms, e-mails, IBAN) : jamais dans le dépôt ni dans une capture partagée. Démonstrations avec `scripts/demo` (données fictives, en local).
- Pour un changement visible ou risqué : une branche puis une pull request. La fusion dans `main` déploie.
- Même modèle technique qu'INES (dépôt `omas-ecos`), mais appli séparée : pas de code partagé entre les deux.

## Technique
- Cloudflare Workers + Hono (`src/`) + D1 (SQLite), interface en modules JS sans compilation (`public/js/`), routes en `#/...`. Logique partagée serveur et navigateur dans `public/js/shared.js` (niveaux, étapes, codes projet, champs obligatoires).
- `src/index.js` : sessions, lien magique, organigramme, administration. `src/projects.js` : projets, circuit, décisions, calendrier, tableau de bord, export, tâche quotidienne. `src/mail.js` : Brevo. `src/util.js` : requêtes et postes.
- Formule gratuite : 50 requêtes D1 et 50 appels sortants par exécution, 100 paramètres par requête.
- Migrations : `migrations/00xx_*.sql`, une instruction par ligne (à coller dans la console D1 en production). Dernière : 0002. L'organigramme IDF est en données (0002), modifiable depuis l'administration.
- Secrets du Worker : `ADMIN_PASSWORD` (compte technique), `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` (facultatif), `MAIL_REPLY_TO` (facultatif), `SITE_URL` (pour les liens dans les e-mails envoyés par la tâche planifiée). En local, `DEV_LINKS=1` renvoie le lien de connexion dans la réponse quand Brevo n'est pas configuré.
- Tâche planifiée `0 7 * * *` (UTC) : escalade des demandes en retard, rappels à 48 h, rappels de bilan, ménage.
- Sécurité : `public/_headers` (CSP stricte, pas de gestionnaire en ligne), cookies httpOnly, contrôle d'origine sur les écritures, limite de tentatives par adresse IP.

## Règles métier à ne pas casser
- Niveau d'un projet (`computeLevel`) : 0 sans budget ni engagement ; 1 jusqu'à `l1` € ; 2 au-delà ou lieu hors fac ou matériel ; 3 au-delà de `l2` € ou intervenant extérieur, communication publique, partenaire ; 4 national. Seuils dans `settings.rules`.
- Étapes : N+1 toujours ; trésorier dès le niveau 2 ; bureau restreint au niveau 3 (`quorum` voix). Un poste n'apparaît qu'une fois dans un circuit.
- Le N+1 est le `parent_id` du poste du porteur. On saute les postes tenus par le porteur lui-même et les postes vacants. Faute de parent, un membre du bureau (vice-manager étudiants de préférence).
- Le silence ne vaut pas accord : passé `due_at`, la tâche quotidienne crée une demande pour le parent du poste muet (`escalated = 1` sur l'original).
- Refus, ajournement et complément exigent un motif. Un porteur ne décide jamais sur son propre projet.
- Le code `EXEX-IDF-UNITE-DOMAINE-NNN` est attribué à la validation, numéro séquentiel par exercice (1er septembre au 31 août).
- Un porteur avec un projet passé non clôturé depuis plus de 15 jours ne peut pas déposer de projet avec budget.

## Travailler en local
```bash
npm install
printf 'ADMIN_PASSWORD=test-admin\nDEV_LINKS=1\n' > .dev.vars
npx wrangler d1 migrations apply omas-projets --local
npm run dev                      # http://localhost:8788
node scripts/demo/seed.mjs       # personnes et projets fictifs, liens de connexion de test
python3 scripts/demo/shots.py    # captures dans scripts/demo/shots/
```
Pour repartir d'une base vide : arrêter le serveur, supprimer `.wrangler/state`, relancer la migration locale.

## Prochains lots (détail dans le cadrage)
- Lot 2, l'argent : notes de frais avec justificatif, import des transactions Qonto, rattachement au code projet, fichier de virements groupés, enveloppes par carte.
- Lot 3, bilans : points d'étape J-30 et J-7, bilan post-projet structuré, synthèse PDF, bilans d'antenne et de pôle, page « mon année ».
- Lot 4 : autres localités, niveau national dans l'appli.
