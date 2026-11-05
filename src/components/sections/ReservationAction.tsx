import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, MailCheck, Ticket } from 'lucide-react';
import { Button } from '../ui/button';
import { getShow, getVenue } from '../../config/shows';
import {
  CLOSED_COPY,
  CONTACT_EMAIL,
  INVALID_LINK_COPY,
  contactMailto,
  fullText,
  recapFailedText,
} from '../../config/billetterieCopy';
import {
  type ApiResult,
  type Preview,
  type ReservationActionKind,
  GENERIC_ERROR,
  NETWORK_ERROR,
  failureText,
  isClosed,
  isShowStarted,
  isReservationId,
  parseCancelResult,
  parseConfirmResult,
  parsePreview,
  requestReservation,
  requestReservationAction,
} from '../../lib/billetterieApi';

export type { ReservationActionKind };

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: Preview; banner?: string }
  | { kind: 'submitting'; preview: Preview }
  | { kind: 'full'; remaining: number; requested: number }
  | { kind: 'closed' }
  | { kind: 'notPossible'; message: string }
  | { kind: 'already'; what: 'confirmed' | 'cancelled' }
  | { kind: 'done'; emailSent: boolean | null };

const LOADING: State = { kind: 'loading' };
const INVALID: State = { kind: 'invalid' };

const COPY = {
  confirm: {
    title: 'Confirmer ma réservation',
    intro: 'confirmez votre réservation',
    button: 'Confirmer ma réservation',
    submitting: 'Confirmation en cours…',
  },
  cancel: {
    title: 'Annuler ma réservation',
    intro: "vous êtes sur le point d'annuler votre réservation",
    button: "Confirmer l'annulation",
    submitting: 'Annulation en cours…',
  },
};

const LINK_CLASS = 'text-teal-deep underline underline-offset-4';
const TEXT_CLASS = 'text-text-muted text-sm leading-relaxed';

function places(n: number): string {
  return `${n} place${n > 1 ? 's' : ''}`;
}

function remainingSeats(preview: Preview): number {
  return preview.kind === 'confirm' ? Math.max(0, Math.floor(preview.availability)) : 0;
}

function stateFromPreview(action: ReservationActionKind, id: string, preview: Preview): State {
  if (preview.id !== id || preview.kind !== action || !getShow(preview.showId)) return INVALID;

  if (preview.kind === 'confirm') {
    if (preview.status === 'confirmed') return { kind: 'already', what: 'confirmed' };
    if (preview.status === 'closed') return INVALID;
    if (preview.status === 'full') return { kind: 'full', remaining: remainingSeats(preview), requested: preview.quantity };
    return preview.open ? { kind: 'ready', preview } : { kind: 'closed' };
  }

  if (preview.status === 'cancelled') return { kind: 'already', what: 'cancelled' };
  return preview.closed ? INVALID : { kind: 'ready', preview };
}

function stateFromGet(action: ReservationActionKind, id: string, result: ApiResult): State {
  if (result.ok) {
    const preview = parsePreview(result.data);
    return preview ? stateFromPreview(action, id, preview) : INVALID;
  }
  const { failure } = result;
  if (failure.kind === 'http' && (failure.status === 400 || failure.status === 404 || isClosed(failure) || isShowStarted(failure))) return INVALID;
  return { kind: 'error', message: failureText(failure) };
}

function stateFromPost(action: ReservationActionKind, preview: Preview, result: ApiResult): State {
  const retry = (banner: string): State => ({ kind: 'ready', preview, banner });

  if (result.ok) {
    if (action === 'confirm') {
      const confirmed = parseConfirmResult(result.data);
      if (!confirmed) return retry(GENERIC_ERROR);
      if (confirmed.alreadyConfirmed || confirmed.emailSent === null) return { kind: 'already', what: 'confirmed' };
      return { kind: 'done', emailSent: confirmed.emailSent };
    }
    const cancelled = parseCancelResult(result.data);
    if (!cancelled) return retry(GENERIC_ERROR);
    if (cancelled.alreadyCancelled) return { kind: 'already', what: 'cancelled' };
    return { kind: 'done', emailSent: cancelled.emailSent };
  }

  const { failure } = result;
  if (failure.kind === 'network') return retry(NETWORK_ERROR);
  if (action === 'confirm' && failure.code === 'full') {
    return { kind: 'full', remaining: failure.remaining ?? remainingSeats(preview), requested: preview.quantity };
  }
  if (failure.code === 'not-possible') return { kind: 'notPossible', message: failureText(failure) };
  if (isShowStarted(failure)) return INVALID;
  if (isClosed(failure)) return action === 'confirm' ? { kind: 'closed' } : INVALID;
  if (failure.status === 400 || failure.status === 404) return INVALID;
  return retry(failureText(failure));
}

function ContactLink({ subject }: { subject?: string }) {
  return (
    <a href={contactMailto(subject)} className={LINK_CLASS}>
      {CONTACT_EMAIL}
    </a>
  );
}

export default function ReservationAction({ action, id, token }: { action: ReservationActionKind; id: string; token: string }) {
  const valid = token !== '' && isReservationId(id);
  const [state, setState] = useState<State>(valid ? LOADING : INVALID);
  const [attempt, setAttempt] = useState(0);
  const sending = useRef(false);
  const mounted = useRef(true);
  const copy = COPY[action];
  const numberSubject = `Réservation ${id}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!valid) {
      setState(INVALID);
      return undefined;
    }
    let active = true;
    setState(LOADING);
    requestReservation(id, token).then((result) => {
      if (active) setState(stateFromGet(action, id, result));
    });
    return () => {
      active = false;
    };
  }, [action, id, token, valid, attempt]);

  async function submit(preview: Preview) {
    if (sending.current) return;
    sending.current = true;
    setState({ kind: 'submitting', preview });
    const result = await requestReservationAction(action, id, token);
    sending.current = false;
    if (mounted.current) setState(stateFromPost(action, preview, result));
  }

  let content: React.ReactNode;
  switch (state.kind) {
    case 'loading':
      content = (
        <p role="status" className={TEXT_CLASS}>
          Chargement de votre réservation…
        </p>
      );
      break;

    case 'error':
      content = (
        <>
          <AlertCircle size={40} className="text-red-700" />
          <p role="alert" className={TEXT_CLASS}>
            {state.message}
          </p>
          <Button variant="dark" size="lg" className="rounded-full w-full mt-2" onClick={() => setAttempt((n) => n + 1)}>
            Réessayer
          </Button>
        </>
      );
      break;

    case 'invalid':
      content = (
        <>
          <AlertCircle size={40} className="text-purple" />
          <p className={TEXT_CLASS}>{INVALID_LINK_COPY}</p>
          <p className={TEXT_CLASS}>
            <ContactLink />
          </p>
        </>
      );
      break;

    case 'closed':
      content = (
        <>
          <AlertCircle size={40} className="text-purple" />
          <p className={TEXT_CLASS}>{CLOSED_COPY.text}</p>
          <p className={TEXT_CLASS}>{CLOSED_COPY.notReserved}</p>
        </>
      );
      break;

    case 'full':
      content = (
        <>
          <AlertCircle size={40} className="text-purple" />
          <p className={TEXT_CLASS}>{fullText(state.remaining, state.requested)}</p>
          <p className={TEXT_CLASS}>
            Faites une nouvelle demande depuis la billetterie ou écrivez-nous : <ContactLink subject={numberSubject} />
          </p>
        </>
      );
      break;

    case 'notPossible':
      content = (
        <>
          <AlertCircle size={40} className="text-red-700" />
          <p role="alert" className={TEXT_CLASS}>
            {state.message}
          </p>
          <p className={TEXT_CLASS}>
            Écrivez-nous : <ContactLink subject={numberSubject} />
          </p>
        </>
      );
      break;

    case 'already':
      content =
        state.what === 'confirmed' ? (
          <>
            <CheckCircle2 size={40} className="text-teal" />
            <h3 className="font-display text-2xl font-bold text-text-primary">Réservation déjà confirmée</h3>
            <p className={TEXT_CLASS}>
              Votre réservation n° <strong className="text-text-primary">{id}</strong> est déjà confirmée. Si vous n'avez pas reçu l'email
              récapitulatif, vérifiez vos spams ou contactez-nous : <ContactLink subject={numberSubject} />
            </p>
          </>
        ) : (
          <>
            <CheckCircle2 size={40} className="text-teal" />
            <h3 className="font-display text-2xl font-bold text-text-primary">Réservation déjà annulée</h3>
            <p className={TEXT_CLASS}>Cette réservation a déjà été annulée : vos places sont libérées.</p>
          </>
        );
      break;

    case 'done':
      content =
        action === 'confirm' ? (
          <>
            <CheckCircle2 size={40} className="text-teal" />
            <h3 className="font-display text-2xl font-bold text-text-primary">Réservation confirmée !</h3>
            {state.emailSent ? (
              <p className={TEXT_CLASS}>
                Vos places sont réservées. Un email récapitulatif vous a été envoyé, avec un lien pour l'ajouter à votre agenda et un lien
                d'annulation en cas d'empêchement.
              </p>
            ) : (
              <p className={TEXT_CLASS}>
                {recapFailedText(id)} <ContactLink subject={numberSubject} />
              </p>
            )}
          </>
        ) : (
          <>
            <CheckCircle2 size={40} className="text-teal" />
            <h3 className="font-display text-2xl font-bold text-text-primary">Réservation annulée</h3>
            <p className={TEXT_CLASS}>
              Vos places ont été libérées.{' '}
              {state.emailSent === true && "Un email de confirmation vous a été envoyé. Merci d'avoir pensé aux autres spectateur·ice·s !"}
              {state.emailSent === false &&
                "L'email de confirmation n'a pas pu être envoyé, l'annulation est bien enregistrée."}
            </p>
          </>
        );
      break;

    default: {
      const { preview } = state;
      const submitting = state.kind === 'submitting';
      const banner = state.kind === 'ready' ? state.banner : undefined;
      const show = getShow(preview.showId);
      const venue = show && getVenue(show.venueId);
      const Icon = action === 'confirm' ? MailCheck : Ticket;
      content = (
        <>
          <Icon size={40} className="text-purple" />
          <h3 className="font-display text-2xl font-bold text-text-primary">{copy.title}</h3>
          <p className={TEXT_CLASS}>
            {preview.name}, {copy.intro} <strong className="text-text-primary">{preview.id}</strong> :
          </p>
          <p className={TEXT_CLASS}>
            {places(preview.quantity)} — {show?.label}
            {venue && <>, {venue.name}</>}.
          </p>
          {preview.kind === 'confirm' && <p className={TEXT_CLASS}>{`Il reste ${places(remainingSeats(preview))}`}</p>}
          {banner && (
            <p role="alert" className="text-red-700 text-sm leading-relaxed">
              {banner}
            </p>
          )}
          <Button variant="dark" size="lg" className="rounded-full w-full mt-2" disabled={submitting} onClick={() => submit(preview)}>
            {submitting ? copy.submitting : copy.button}
          </Button>
        </>
      );
    }
  }

  return (
    <section className="py-24 bg-background">
      <div className="max-w-md mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-8 shadow-card border border-black/6 text-center flex flex-col items-center gap-3"
        >
          {content}
        </motion.div>
        <p className="text-center mt-6">
          <Link to="/billetterie" className="text-sm text-teal-deep underline underline-offset-4">
            Retour à la billetterie
          </Link>
        </p>
      </div>
    </section>
  );
}
