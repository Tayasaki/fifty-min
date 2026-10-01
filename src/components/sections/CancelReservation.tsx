import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Ticket } from 'lucide-react';
import { Button } from '../ui/button';
import { getShow, getVenue } from '../../config/shows';

interface ReservationDetails {
  id: string;
  showId: string;
  name: string;
  quantity: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; reservation: ReservationDetails }
  | { kind: 'cancelling'; reservation: ReservationDetails }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export default function CancelReservation({ id, token }: { id: string; token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const params = new URLSearchParams({ id, token });
    fetch(`/api/cancel?${params}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) setState({ kind: 'error', message: data.error || 'Une erreur est survenue.' });
        else setState({ kind: 'ready', reservation: data });
      })
      .catch(() => setState({ kind: 'error', message: 'Impossible de contacter le serveur. Merci de réessayer.' }));
  }, [id, token]);

  async function handleCancel(reservation: ReservationDetails) {
    setState({ kind: 'cancelling', reservation });
    try {
      const res = await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, token }),
      });
      const data = await res.json();
      if (!res.ok) setState({ kind: 'error', message: data.error || 'Une erreur est survenue.' });
      else setState({ kind: 'cancelled' });
    } catch {
      setState({ kind: 'error', message: 'Impossible de contacter le serveur. Merci de réessayer.' });
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
  } else if (state.kind === 'cancelled') {
    content = (
      <>
        <CheckCircle2 size={40} className="text-teal" />
        <h3 className="font-display text-2xl font-bold text-text-primary">Réservation annulée</h3>
        <p className="text-text-muted text-sm leading-relaxed">
          Vos places ont été libérées. Un email de confirmation vous a été envoyé. Merci d'avoir pensé aux autres
          spectateur·ice·s !
        </p>
      </>
    );
  } else {
    const { reservation } = state;
    const show = getShow(reservation.showId);
    const venue = show && getVenue(show.venueId);
    content = (
      <>
        <Ticket size={40} className="text-purple" />
        <h3 className="font-display text-2xl font-bold text-text-primary">Annuler ma réservation</h3>
        <p className="text-text-muted text-sm leading-relaxed">
          {reservation.name}, vous êtes sur le point d'annuler votre réservation{' '}
          <strong className="text-text-primary">{reservation.id}</strong> :
          <br />
          {reservation.quantity} place{reservation.quantity > 1 ? 's' : ''} — {show?.label}
          {venue && <>, {venue.name}</>}.
        </p>
        <Button
          variant="dark"
          size="lg"
          className="rounded-full w-full mt-2"
          disabled={state.kind === 'cancelling'}
          onClick={() => handleCancel(reservation)}
        >
          {state.kind === 'cancelling' ? 'Annulation en cours…' : "Confirmer l'annulation"}
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
