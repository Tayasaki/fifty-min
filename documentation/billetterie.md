---
type: reference
status: current
review_trigger: "on file change"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/reference/billetterie-api-contract.md, documentation/runbooks/api-tests.md, documentation/runbooks/ui-tests.md, documentation/runbooks/billetterie-launch-checklist.md]
---

# Billetterie (réservation gratuite)

Guide d'exploitation de la billetterie : fonctionnement, variables d'environnement, export, fermeture rapide, données personnelles. Les codes d'erreur et les formes de réponse sont dans `documentation/reference/billetterie-api-contract.md` (non dupliqués ici). La mise en service pas à pas est dans `documentation/runbooks/billetterie-launch-checklist.md`.

## Fonctionnement

Les places ne sont **pas bloquées** à la demande : elles sont attribuées au clic sur le bouton de confirmation (ADR-002).

1. Le formulaire (`src/components/sections/TicketingSection.tsx`) envoie nom, email, nombre de places et le jeton Cloudflare Turnstile à `POST /api/reserve`.
2. Le serveur vérifie les champs, la fermeture éventuelle, le captcha et le quota d'envoi, puis envoie un email contenant un **lien signé** valable 48 h. Aucune place n'est écrite.
3. Le lien ouvre `/billetterie?confirmer=<id>&token=<jeton>` : une page en lecture seule (`GET /api/reservation`) qui affiche la demande. Un antivirus qui ouvre le lien ne réserve donc rien.
4. Le bouton « Confirmer ma réservation » envoie `POST /api/reservation` avec `action: 'confirm'`. Le serveur attribue alors les places de façon atomique (script Lua Redis). Si la salle est pleine entre-temps, la personne le voit.
5. Un email récapitulatif part avec un fichier `.ics`, un lien Google Agenda et le lien d'annulation `/billetterie?annuler=<id>&token=<jeton>`.
6. L'annulation (`action: 'cancel'`) libère les places et bloque le lien de confirmation d'origine : il ne peut plus réserver.

| Point d'accès | Rôle |
|---|---|
| `GET /api/availability` | places restantes par date et ouverture (`open`) |
| `POST /api/reserve` | demande : envoie le lien signé |
| `GET /api/reservation` | lecture seule d'un lien de confirmation ou d'annulation |
| `POST /api/reservation` | `confirm` ou `cancel` |
| `GET /api/reservations` | export CSV pour l'accueil (en-tête `Authorization`) |

Deux interrupteurs distincts :

| Interrupteur | Type | Effet | Pour le changer |
|---|---|---|---|
| `REACT_APP_SHOW_TICKETING` | compilation | la page affiche le formulaire (valeur exacte `true`) ou « Bientôt disponible » | reconstruire (redéployer) |
| `RESERVATIONS_OPEN` | exécution | le serveur accepte demandes et confirmations (valeur `true`, casse et espaces ignorés) | modifier la variable **puis redéployer** : Vercel lie les variables au déploiement |

Si `RESERVATIONS_OPEN` n'est pas défini, les réservations sont **fermées**. L'annulation et la lecture des liens restent possibles quand c'est fermé.

## Variables d'environnement

| Variable | Type | Obligatoire | Défaut / effet si absente |
|---|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | exécution | oui | injectées par l'intégration Upstash ; sinon erreur 503 (`UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` sont acceptées à la place) |
| `RESEND_API_KEY` | exécution | oui | sans clé, `POST /api/reserve` répond 503 |
| `RESERVATION_FROM_EMAIL` | exécution | non | `Mélange de Genres <billetterie@melangedegenres.ch>` |
| `RESERVATION_REPLY_TO` | exécution | non | `infomelangesdegenres@gmail.com` |
| `LINK_SECRET` | exécution | oui | au moins 32 caractères ; sinon 503 |
| `LINK_SECRET_KID` | exécution | non | `1` : identifiant de la clé courante |
| `LINK_SECRET_PREVIOUS` | exécution | non | ancienne clé acceptée pendant une rotation (32 caractères minimum) |
| `LINK_SECRET_PREVIOUS_KID` | exécution | non | `0` : identifiant de l'ancienne clé |
| `ADMIN_TOKEN` | exécution | pour l'export | au moins 32 caractères ; en dessous, l'export répond 503 |
| `TURNSTILE_SECRET_KEY` | exécution | oui | sans clé, 503 (le captcha ne laisse rien passer) |
| `REACT_APP_TURNSTILE_SITE_KEY` | compilation | oui avec le formulaire | absente : le formulaire affiche le panneau « indisponible » |
| `REACT_APP_SHOW_TICKETING` | compilation | non | `true` ouvre l'affichage du formulaire |
| `RESERVATIONS_OPEN` | exécution | non | non défini = fermé |
| `PUBLIC_SITE_URL` | exécution | non | forcer l'adresse publique des liens ; laisser vide (voir plus bas) |

Variables système Vercel lues par `api/_lib/site.ts` : `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`.

| Environnement | Adresse des liens dans les emails | Origines acceptées par `POST /api/reserve` |
|---|---|---|
| Production | `SITE_URL` de `src/config/seo.ts` (`https://melangedegenres.ch`), ou `PUBLIC_SITE_URL` | le site, `PUBLIC_SITE_URL`, `VERCEL_PROJECT_PRODUCTION_URL` |
| Preview | `VERCEL_URL` du déploiement (jamais le site de production) | l'adresse des liens, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `http://localhost:3000` |
| Development | `VERCEL_URL`, sinon `http://localhost:3000` | idem Preview |

Matrice recommandée (une base Redis et une clé Resend **par environnement**, secrets différents) :

| Variable | Production | Preview | Development |
|---|---|---|---|
| base Redis (`KV_*`) | base de production | base de test | base de test |
| `RESEND_API_KEY` | clé de production | clé distincte | idem Preview |
| `TURNSTILE_SECRET_KEY`, `REACT_APP_TURNSTILE_SITE_KEY` | widget de production | widget de prévisualisation ou paire de test | paire de test |
| `LINK_SECRET`, `ADMIN_TOKEN` | valeurs propres, 32 caractères ou plus | valeurs différentes | valeurs différentes |
| `RESERVATIONS_OPEN` | non défini ou `false` jusqu'à l'ouverture | `true` pour les tests | `true` |
| `REACT_APP_SHOW_TICKETING` | `true` à l'ouverture | `true` | `true` |

La paire de test Cloudflare (toujours valide) est donnée dans `documentation/runbooks/ui-tests.md`. Ne jamais la laisser en production.

## Export organisateur

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://<site>/api/reservations?show=<showId>" -o liste.csv
```

- Sans `show`, toutes les dates sont exportées. L'identifiant d'une date est la clé `id` de `src/config/shows.ts` (par exemple `2027-02-20-monique`).
- Le jeton dans l'adresse (`?token=`) n'est plus lu : seul l'en-tête `Authorization` fonctionne.
- Colonnes : `date;reservation;statut;nom;email;places;reserve_le`. Statuts : `confirmée`, `annulée`, `inconnu`. Les cellules qui commencent par `=`, `+`, `-` ou `@` reçoivent une apostrophe pour ne pas s'exécuter comme formule dans un tableur.
- `ADMIN_TOKEN` fait au moins 32 caractères, sinon l'export répond 503 avant toute vérification.

## Fermer rapidement les réservations

1. Vercel → Settings → Environment Variables : mettre `RESERVATIONS_OPEN` à `false` (Production).
2. Redéployer (Deployments → Redeploy). Sans redéploiement rien ne change.
3. Attendre environ 10 secondes : le cache CDN de `GET /api/availability` est de 10 secondes (`s-maxage=10`).

Résultat : la page affiche « Les réservations ne sont pas ouvertes pour le moment », `POST /api/reserve` répond 403 `closed`. Les places déjà confirmées restent confirmées. Les liens déjà envoyés s'ouvrent encore mais ne peuvent plus confirmer.

Option la plus rapide : Instant Rollback vers le déploiement précédent (celui d'avant l'ouverture, billetterie fermée). À répéter une fois sur Preview avant de s'y fier : les limites du plan Hobby ne sont pas vérifiées ici. Pour rouvrir : l'opération inverse (`true`, puis redéployer).

## Données personnelles

| Donnée | Clé Redis | Durée |
|---|---|---|
| nom, email, places, jetons | `reservation:<id>` | jusqu'à 30 jours après le début de la date |
| compteur de places | `show:<showId>:booked` | idem |
| places par email (adresse canonique) | `show:<showId>:emails` (hash) | idem |
| places par domaine | `show:<showId>:domains` (hash) | idem |
| ids des réservations confirmées | `show:<showId>:reservations` (liste) | idem |
| blocage d'un lien annulé (sans donnée personnelle) | `tombstone:<id>` | idem |
| délai entre deux demandes pour une adresse | `quota:cooldown:<adresse>` | 600 secondes |
| budget d'envoi du jour | `quota:sent:<date UTC>` | un jour |

La durée de conservation est `RECORD_RETENTION_DAYS` (30 jours) après le début de la date : chaque clé reçoit un `EXPIREAT`, aucune tâche planifiée n'est nécessaire. Une annulation garde l'enregistrement avec le statut `cancelled` jusqu'à la même échéance. Un avis d'information est affiché sous le formulaire.

### Effacer les données d'une personne (demande écrite, opération manuelle rare)

À faire dans la console Upstash (onglet CLI) de la base de **l'environnement concerné**. Les commandes reprennent `releaseAtomic` dans `api/_lib/redis.ts`.

1. Retrouver l'identifiant (`<ID>`, 8 caractères) avec l'export CSV, puis lire l'enregistrement : `GET reservation:<ID>`. Noter `showId`, `quantity`, `canonicalEmail`, `domain`, `status`, et l'échéance `<EXPIREAT>` = début de la date en secondes + 30 × 86400 (`EXPIRETIME reservation:<ID>` la donne directement).
2. Bloquer d'abord le lien : `SET tombstone:<ID> 1` puis `EXPIREAT tombstone:<ID> <EXPIREAT>`.
3. Si `status` vaut `confirmed`, rendre les places : `DECRBY show:<showId>:booked <quantity>`, `HINCRBY show:<showId>:emails <canonicalEmail> -<quantity>`, `HINCRBY show:<showId>:domains <domain> -<quantity>`, `LREM show:<showId>:reservations 0 <ID>`.
4. Retirer l'adresse du hash quand son compteur est à 0 : `HGET show:<showId>:emails <canonicalEmail>` puis, si le résultat est `0`, `HDEL show:<showId>:emails <canonicalEmail>` (idem pour `domains`, qui ne contient pas d'adresse).
5. Supprimer l'enregistrement : `DEL reservation:<ID>`. Si une demande a eu lieu il y a moins de 10 minutes : `DEL quota:cooldown:<canonicalEmail>`.

Si `status` vaut `cancelled`, les places sont déjà rendues : ne faire que les étapes 2, 4 et 5. Si l'enregistrement a déjà expiré (`GET` répond vide), il n'y a plus rien à effacer. Une action d'effacement dans l'application est une évolution listée dans la check-list de lancement.

## Modifier une capacité ou ajouter une date

- Modifier `src/config/shows.ts` et redéployer. Les compteurs sont dans Redis sous l'identifiant de la date : **ne jamais renommer un `id`** (c'est la clé Redis).
- Augmenter une capacité est sans risque. La baisser sous le nombre de places déjà réservées provoque une sur-réservation silencieuse.
- Ajouter une date : une ligne dans `SHOWS` ; les clés apparaissent à la première confirmation.
- La capacité du Théâtre Le Monique est fixée à 100 (valeur prudente), le lieu a peut-être 120 places : question ouverte, étape 0 de la check-list de lancement.

## Développement local

`pnpm start` ne sert pas `/api`. Avec Vercel : `vercel link`, `vercel env pull .env.local`, puis `vercel dev` exécute les fonctions sur une vraie base. Utiliser la base de **test**, jamais celle de production.

Sans Vercel, le banc d'essai complet :

```bash
pnpm run test:api:redis        # Redis jetable sur 127.0.0.1:6390
pnpm run test:api              # tests de l'API (node:test)
pnpm run typecheck:api
CI=true pnpm run test:ui       # tests de l'interface
```

Détails : `documentation/runbooks/api-tests.md` et `documentation/runbooks/ui-tests.md` (clés Turnstile de test comprises).

## Limites connues

- La version compilée sans `REACT_APP_SHOW_TICKETING` contient encore une phrase d'accroche qui n'est jamais affichée (`buildTeasers` reçoit l'indicateur à l'exécution). Correctif d'une ligne : passer la chaîne de description à `buildTeasers`.
- `react-snap` n'a pas pu pré-générer `/billetterie` lors des essais locaux (4 essais sur 4 en échec, masqués par `|| true`). La page fonctionne côté navigateur ; le pré-rendu est à contrôler dans le journal de build Vercel.
- Une date commencée reste affichée jusqu'au clic : l'API répond `show-started`, la page désactive cette date et laisse les autres réservables.
- Le budget d'envoi (`DAILY_REQUEST_EMAIL_BUDGET`, 60 par jour UTC) compte les emails de demande, de récapitulatif et d'annulation dans un même compteur et ne refuse que les nouvelles demandes.
- Pas de CI, pas d'alerte automatique, pas d'email groupé aux participants, pas de pointage ni d'annulation par l'organisateur.
