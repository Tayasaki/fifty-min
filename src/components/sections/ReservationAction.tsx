import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, MailCheck, Ticket } from 'lucide-react';
import { Button } from '../ui/button';
import { getShow, getVenue } from '../../config/shows';

export type ReservationActionKind = 'confirm' | 'cancel';

interface ReservationDetails {
  id: string;
  showId: string;
  name: string;
  quantity: number;
  status: 'pending' | 'confirmed';
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; reservation: ReservationDetails }
  | { kind: 'submitting'; reservation: ReservationDetails }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const COPY = {
  confirm: {
    title: 'Confirmer ma réservation',
    intro: 'confirmez votre réservation',
    button: 'Confirmer ma réservation',
    submitting: 'Confirmation en cours…',
    doneTitle: 'Réservation confirmée !',
    doneText:
      "Vos places sont réservées. Un email récapitulatif vous a été envoyé, avec un lien pour l'ajouter à votre agenda et un lien d'annulation en cas d'empêchement.",
  },
  cancel: {
    title: 'Annuler ma réservation',
    intro: "vous êtes sur le point d'annuler votre réservation",
    button: "Confirmer l'annulation",
    submitting: 'Annulation en cours…',
    doneTitle: 'Réservation annulée',
    doneText: "Vos places ont été libérées. Un email de confirmation vous a été envoyé. Merci d'avoir pensé aux autres spectateur·ice·s !",
  },
};

const NETWORK_ERROR = 'Impossible de contacter le serveur. Merci de réessayer.';

export default function ReservationAction({ action, id, token }: { action: ReservationActionKind; id: string; token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const copy = COPY[action];

  useEffect(() => {
    const params = new URLSearchParams({ id, token });
    fetch(`/api/reservation?${params}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) setState({ kind: 'error', message: data.error || 'Une erreur est survenue.' });
        else if (action === 'confirm' && data.status === 'confirmed') setState({ kind: 'done' });
        else setState({ kind: 'ready', reservation: data });
      })
      .catch(() => setState({ kind: 'error', message: NETWORK_ERROR }));
  }, [action, id, token]);

  async function handleSubmit(reservation: ReservationDetails) {
    setState({ kind: 'submitting', reservation });
    try {
      const res = await fetch('/api/reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, token }),
      });
      const data = await res.json();
      if (!res.ok) setState({ kind: 'error', message: data.error || 'Une erreur est survenue.' });
      else setState({ kind: 'done' });
    } catch {
      setState({ kind: 'error', message: NETWORK_ERROR });
    }
  }

  let content: React.ReactNode;
  if (state.kind === 'loading') {
    content = <p className="text-text-muted text-sm">Chargement de votre réservation…</p>;
  } else if (state.kind === 'error') {
    content = (
      <>
        <AlertCircle size={40} className="text-red-700" />
        <p className="text-text-muted text-sm leading-relaxed">{state.message}</p>
      </>
    );
  } else if (state.kind === 'done') {
    content = (
      <>
        <CheckCircle2 size={40} className="text-teal" />
        <h3 className="font-display text-2xl font-bold text-text-primary">{copy.doneTitle}</h3>
        <p className="text-text-muted text-sm leading-relaxed">{copy.doneText}</p>
      </>
    );
  } else {
    const { reservation } = state;
    const show = getShow(reservation.showId);
    const venue = show && getVenue(show.venueId);
    const Icon = action === 'confirm' ? MailCheck : Ticket;
    content = (
      <>
        <Icon size={40} className="text-purple" />
        <h3 className="font-display text-2xl font-bold text-text-primary">{copy.title}</h3>
        <p className="text-text-muted text-sm leading-relaxed">
          {reservation.name}, {copy.intro} <strong className="text-text-primary">{reservation.id}</strong> :
          <br />
          {reservation.quantity} place{reservation.quantity > 1 ? 's' : ''} — {show?.label}
          {venue && <>, {venue.name}</>}.
        </p>
        <Button
          variant="dark"
          size="lg"
          className="rounded-full w-full mt-2"
          disabled={state.kind === 'submitting'}
          onClick={() => handleSubmit(reservation)}
        >
          {state.kind === 'submitting' ? copy.submitting : copy.button}
        </Button>
      </>
    );
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
