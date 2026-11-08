# Cap · projets OMAS Île-de-France

Déclarer un projet, le faire valider par la bonne personne dans un délai, le suivre jusqu'au bilan. Cloudflare Workers, Hono, D1. Voir `CLAUDE.md` pour les conventions et la mise en route.

## Mise en production (première fois)
1. `npx wrangler d1 create omas-projets`, reporter l'identifiant dans `wrangler.jsonc`.
2. Coller le contenu de `migrations/0001_init.sql` puis `0002_organigramme_idf.sql` dans la console D1.
3. Secrets : `npx wrangler secret put ADMIN_PASSWORD` (puis Brevo quand il est prêt : `BREVO_API_KEY`, `MAIL_FROM`, `SITE_URL`).
4. Connecter le dépôt à Cloudflare Workers Builds : chaque fusion dans `main` déploie.
5. Se connecter avec le compte technique, créer le secrétaire IDF (administrateur), lui générer un lien de connexion, puis saisir les personnes et leurs postes.
