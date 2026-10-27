---
type: reference
status: current
review_trigger: "on file change"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/milestones/_active/billetterie-claim-on-confirm/milestone-3.md, documentation/runbooks/api-tests.md]
---

# Billetterie API contract (claim on confirm)

Server contract for the reservation flow in `api/`. A request mails a signed link and holds no seat; seats are claimed only when the link is confirmed. All bodies are JSON and `Cache-Control: no-store` unless stated. Error bodies are `{ error: string, code?: string, retryAfterSeconds?: number, remaining?: number }`; `code` is additive, `remaining` accompanies `full` only.

## Endpoints

| Endpoint | Success | Errors (status, `code`) |
|---|---|---|
| `POST /api/reserve` `{showId, name, email, quantity, turnstileToken, website?}` | `200 {ok:true, linkExpiresAt: ISO}` (no `reservationId`); a filled honeypot returns the same shape | 405, 415, 403 (origin), 413, 400 (fields), 409 `closed` (show started), 403 `closed` (gate), 400 `captcha`, 409 `full` (+`remaining`), 429 `cooldown` (+`Retry-After`, `retryAfterSeconds`), 429 `budget`, 400 `bad-address`, 503 `email-failed` (quota refunded), 503 `email-slow` (not refunded), 503 |
| `GET /api/reservation?id&token` with a signed link | `200 {id, showId, name, quantity, status:'claimable'\|'full'\|'confirmed'\|'closed', availability:number, open:boolean}` | 400 `Lien invalide`, 404, 503 |
| `GET /api/reservation?id&token` with a cancel token | `200 {id, showId, name, quantity, status:'confirmed'\|'cancelled', closed:boolean}` | 400, 404, 503 |
| `POST /api/reservation {action:'confirm', id, token}` | `200 {ok:true, status:'confirmed', id, alreadyConfirmed:boolean, emailSent:boolean\|null}` (`null`: already confirmed, no mail attempted) | 400, 413, 415, 403 `closed`, 404, 409 `closed` (show started), 409 `full` (+`remaining`), 409 `not-possible`, 503 |
| `POST /api/reservation {action:'cancel', id, token}` | `200 {ok:true, status:'cancelled', id, alreadyCancelled:boolean, emailSent:boolean\|null}` | 400, 413, 415, 404, 409 `closed`, 503 |
| `GET /api/availability` | `200 {availability:{[showId]:number}, open:boolean}`, `Cache-Control: public, s-maxage=10, stale-while-revalidate=30` | `503` with `no-store` |
| `GET /api/reservations?show=` (organizer) | `200 text/csv`, `no-store`; an omitted `?show=` exports all shows | 401 (no Bearer header), 403 (wrong token), 404 unknown show, 503 (also when `ADMIN_TOKEN` is unset or shorter than 32 characters) |

`status:'full'` on the preview means the quantity no longer fits; a confirm can still fail with `not-possible` (address or domain cap), so the confirm button needs an error state. `POST /api/reserve` never answers `not-possible`: see the neutral wording rule. `emailSent:false` means the seats are held but the recap mail failed; show the reservation number.

## Tokens and links

- Confirm link: `<base>/billetterie?confirmer=<id>&token=<signed>`; cancel link: `<base>/billetterie?annuler=<id>&token=<cancelToken>`.
- The shape of the token selects the kind: `payload.signature` (base64url) is a signed confirm link, 32 lower-case hex digits is a cancel token. The action must match the kind, otherwise `400 Lien invalide` with no lookup. A well-formed id is 8 upper-case hex digits.
- A signed link is valid for 48 hours and the id is derived from its signature. A bad signature, a forged id, an expired, cancelled or tombstoned link all answer the same `404`.
- The GET preview is read-only, so link scanners cannot claim a seat; only the button POST claims.
- No response contains the cancel token or the signed token. The page URL carries the signed token (name, email, quantity): do not log it client-side.

## Gates and rules

- `RESERVATIONS_OPEN` must be `true` (trimmed, case-insensitive) for `POST /api/reserve` and for confirm. Preview and cancel always work; `open` is echoed. A change needs a redeploy on Vercel.
- Reserve, confirm and cancel are all refused with `409 closed` from the start instant of the show (`now >= start`); `403 closed` is the `RESERVATIONS_OPEN` gate on reserve and confirm.
- `ADMIN_TOKEN` and `LINK_SECRET` must be at least 32 characters (`MIN_SECRET_LENGTH`); a shorter `ADMIN_TOKEN` answers 503 before any Bearer check.
- The request mail greets with `Bonjour,` and carries no text chosen by the requester: it is the only mail sent without proof of mailbox ownership. Recap and cancellation mails greet by name.
- Origin must match the deployment (production site, or the preview hosts) and is checked on `POST /api/reserve` only; confirm and cancel authenticate by their token. The secret `TURNSTILE_SECRET_KEY` is required in every environment (a missing secret is a `503`, test keys go in the env value).
- The send quota is charged before the mail leaves: a refused precheck leaves no cooldown. A definite non-delivery (bad address, provider error, rate limit) refunds the slot; a timeout keeps it.

## Neutral wording rule

`POST /api/reserve` checks only the public availability (`full`, few left), so its answer never depends on the seats an address or its domain already holds and cannot be used to probe them. The email cap and the domain cap are enforced atomically at confirm and return the byte-identical `409 not-possible` body (`MSG.NOT_POSSIBLE`) there. The cooldown message is the only text that reveals a recent request; it is accepted.

## Log rule

Logs carry labels, ids, status codes and error `name` or `kind` only. Never an email, a name, a token, a request body or a provider response body (a Resend body can echo the recipient). Transport error objects of Redis and Turnstile may be logged; provider bodies never. Tests capture the console and assert it.

## Organizer export

`Authorization: Bearer <ADMIN_TOKEN>` only. `?token=` is not read (organizer scripts that used it must send the header). Cells starting with `=`, `+`, `-`, `@`, TAB or CR get a leading apostrophe. Status labels: `confirmée`, `annulée`, `inconnu`.

Client mapping of each `code` to behaviour: `documentation/runbooks/ui-tests.md`.
