# Billetterie (réservation gratuite)

## Fonctionnement

- Dates, salles et capacités : `src/config/shows.ts` (partagé front + API).
- `GET /api/availability` → places restantes par date.
- `POST /api/reserve` → `{ showId, name, email, quantity }`. Vérifie atomiquement (script Lua Redis) la capacité
  et la limite de 4 places par email **et par date**, enregistre, puis envoie l'email de confirmation.
- Annulation : l'email de confirmation contient un lien `/billetterie?annuler=<id>&token=<secret>`. La page affiche
  la réservation et demande de confirmer (le lien seul n'annule rien, car les antivirus des messageries ouvrent les liens).
  `GET /api/cancel` lit la réservation, `POST /api/cancel` libère les places et envoie un email d'annulation.
- `GET /api/reservations?show=<showId>&token=<ADMIN_TOKEN>` → export CSV des réservations (liste pour l'accueil).
  Sans `show`, exporte toutes les dates.
- La page affiche le formulaire uniquement si `REACT_APP_SHOW_TICKETING=true`.

## Mise en service (Vercel)

1. **Redis** : Vercel → Storage → Marketplace → *Upstash for Redis* (plan gratuit), connecter au projet.
   Injecte `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
2. **Email** : créer un compte sur resend.com, vérifier le domaine `melangedegenres.ch` (enregistrements DNS
   fournis par Resend), créer une clé API.
3. **Variables d'environnement** (Vercel → Settings → Environment Variables) :

   | Variable | Valeur |
   |---|---|
   | `RESEND_API_KEY` | clé API Resend |
   | `RESERVATION_FROM_EMAIL` | optionnel, défaut `Mélange de Genres <billetterie@melangedegenres.ch>` |
   | `RESERVATION_REPLY_TO` | optionnel, défaut `infomelangesdegenres@gmail.com` |
   | `ADMIN_TOKEN` | longue chaîne aléatoire, pour l'export CSV |
   | `REACT_APP_SHOW_TICKETING` | `true` pour ouvrir la billetterie |

4. Redéployer.

## Développement local

`pnpm start` ne sert pas `/api`. Utiliser `vercel dev` (après `vercel link` et `vercel env pull .env.local`).

## Modifier une capacité

Changer `capacity` dans `src/config/shows.ts` et redéployer. Les réservations déjà faites sont conservées
(le compteur est dans Redis). Les spectateur·ice·s annulent via le lien de leur email. Les clés Redis sont
`show:<id>:booked`, `show:<id>:emails`, `show:<id>:reservations` et `reservation:<id>`.
