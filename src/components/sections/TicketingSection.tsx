import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../ui/button';
import { MapPin, Clock, Ticket, CheckCircle2, AlertCircle, Accessibility } from 'lucide-react';
import { MAX_TICKETS_PER_EMAIL, SHOWS, VENUES, type Show, getVenue } from '../../config/shows';
import { cn } from '../../lib/utils';

const showTicketing = process.env.REACT_APP_SHOW_TICKETING === 'true';

type Availability = Record<string, number>;

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; reservationId: string; emailSent: boolean; email: string; quantity: number; show: Show };

function remainingLabel(remaining: number | undefined): string {
  if (remaining === undefined) return '';
  if (remaining === 0) return 'Complet';
  if (remaining <= 10) return `Plus que ${remaining} place${remaining > 1 ? 's' : ''}`;
  return 'Places disponibles';
}

function ReservationForm({
  show,
  remaining,
  onSuccess,
}: {
  show: Show;
  remaining: number | undefined;
  onSuccess: (state: Extract<SubmitState, { kind: 'success' }>) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  const venue = getVenue(show.venueId);
  const maxQuantity = Math.max(1, Math.min(MAX_TICKETS_PER_EMAIL, remaining ?? MAX_TICKETS_PER_EMAIL));

  useEffect(() => {
    if (quantity > maxQuantity) setQuantity(maxQuantity);
  }, [quantity, maxQuantity]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId: show.id, name, email, quantity, website }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: 'error', message: data.error || 'Une erreur est survenue.' });
        return;
      }
      onSuccess({ kind: 'success', reservationId: data.reservationId, emailSent: data.emailSent, email, quantity, show });
    } catch {
      setState({ kind: 'error', message: 'Impossible de contacter le serveur. Merci de réessayer.' });
    }
  }

  const inputClass =
    'w-full h-11 rounded-lg border border-black/10 bg-white px-4 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-teal/40';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <p className="text-text-muted text-xs uppercase tracking-wide mb-1">{venue?.name}</p>
        <h3 className="font-display text-xl font-bold text-text-primary">{show.label}</h3>
      </div>

      <label className="flex flex-col gap-1.5 text-sm text-text-primary">
        Nom et prénom
        <input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-text-primary">
        Email
        <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-text-primary">
        Nombre de places
        <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputClass}>
          {Array.from({ length: maxQuantity }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-text-muted text-xs">Maximum {MAX_TICKETS_PER_EMAIL} places par adresse email et par représentation.</span>
      </label>

      {/* Honeypot — hidden from humans */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="hidden"
        aria-hidden="true"
      />

      {state.kind === 'error' && (
        <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg p-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {state.message}
        </p>
      )}

      <Button type="submit" variant="dark" size="lg" className="rounded-full w-full" disabled={state.kind === 'loading'}>
        {state.kind === 'loading' ? 'Réservation en cours…' : 'Réserver gratuitement'}
      </Button>
    </form>
  );
}

export default function TicketingSection() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [success, setSuccess] = useState<Extract<SubmitState, { kind: 'success' }> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function loadAvailability() {
    fetch('/api/availability')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setAvailability(data.availability))
      .catch(() => {});
  }

  useEffect(() => {
    if (showTicketing) loadAvailability();
  }, []);

  function selectShow(id: string) {
    setSelectedId(id);
    setSuccess(null);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  const selectedShow = SHOWS.find((s) => s.id === selectedId);

  return (
    <section id="billetterie" className="py-24 bg-background">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <p className="text-purple text-sm font-medium tracking-widest uppercase mb-3">Réservations</p>
          <h2 className="section-title">Billetterie</h2>
          <div className="w-16 h-1 rounded-full bg-purple mx-auto mt-4" />
          {showTicketing && (
            <p className="section-subtitle max-w-xl mx-auto mt-6">
              L'entrée est gratuite, mais la réservation est obligatoire. Choisissez une date, indiquez votre email et
              recevez votre confirmation.
            </p>
          )}
        </motion.div>

        {showTicketing ? (
          <>
            {/* Venue cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {VENUES.map((venue, i) => (
                <motion.div
                  key={venue.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: i * 0.12 }}
                  viewport={{ once: true }}
                  className="bg-white/70 backdrop-blur-sm rounded-2xl p-8 shadow-card flex flex-col gap-6 border border-black/6"
                >
                  <div>
                    <div className="flex items-start gap-2 mb-1">
                      <MapPin size={15} className="text-text-muted mt-0.5 shrink-0" />
                      <span className="text-text-muted text-xs uppercase tracking-wide">{venue.location}</span>
                    </div>
                    <h3 className="font-display text-xl font-bold text-text-primary uppercase leading-snug">{venue.name}</h3>
                    <p className="text-text-muted text-sm mt-2">{venue.address}</p>
                    <p className="flex items-center gap-1.5 text-teal-deep text-xs mt-1">
                      <Accessibility size={13} className="shrink-0" />
                      {venue.accessibility}
                    </p>
                  </div>

                  <ul className="flex flex-col gap-2">
                    {SHOWS.filter((s) => s.venueId === venue.id).map((show) => {
                      const remaining = availability?.[show.id];
                      const soldOut = remaining === 0;
                      const selected = show.id === selectedId;
                      return (
                        <li key={show.id}>
                          <button
                            type="button"
                            disabled={soldOut}
                            onClick={() => selectShow(show.id)}
                            className={cn(
                              'w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
                              selected
                                ? 'border-purple bg-purple/10'
                                : 'border-black/8 bg-white hover:border-purple/60',
                              soldOut && 'opacity-50 cursor-not-allowed hover:border-black/8'
                            )}
                          >
                            <span className="flex items-center gap-2 text-text-primary">
                              <Clock size={13} className="text-purple shrink-0" />
                              {show.label}
                            </span>
                            <span className={cn('text-xs whitespace-nowrap', soldOut ? 'text-red-700' : 'text-teal-deep')}>
                              {remainingLabel(remaining)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </motion.div>
              ))}
            </div>

            {/* Reservation panel */}
            <div ref={panelRef} className="max-w-md mx-auto mt-10">
              <AnimatePresence mode="wait">
                {success ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-white rounded-2xl p-8 shadow-card border border-teal/30 text-center flex flex-col items-center gap-3"
                  >
                    <CheckCircle2 size={40} className="text-teal" />
                    <h3 className="font-display text-2xl font-bold text-text-primary">Réservation confirmée !</h3>
                    <p className="text-text-muted text-sm leading-relaxed">
                      {success.quantity} place{success.quantity > 1 ? 's' : ''} pour le {success.show.label.toLowerCase()}.
                      <br />
                      Numéro de réservation : <strong className="text-text-primary">{success.reservationId}</strong>
                    </p>
                    <p className="text-text-muted text-sm">
                      {success.emailSent
                        ? `Un email de confirmation a été envoyé à ${success.email}.`
                        : "Votre réservation est enregistrée, mais l'email de confirmation n'a pas pu être envoyé. Notez votre numéro de réservation."}
                    </p>
                    <Button variant="outline" className="rounded-full mt-2" onClick={() => setSuccess(null)}>
                      Nouvelle réservation
                    </Button>
                  </motion.div>
                ) : selectedShow ? (
                  <motion.div
                    key={selectedShow.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-white rounded-2xl p-8 shadow-card border border-black/6"
                  >
                    <ReservationForm
                      show={selectedShow}
                      remaining={availability?.[selectedShow.id]}
                      onSuccess={(s) => {
                        setSuccess(s);
                        setSelectedId(null);
                        loadAvailability();
                      }}
                    />
                  </motion.div>
                ) : (
                  <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-text-muted text-sm">
                    Sélectionnez une date pour réserver vos places.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            viewport={{ once: true }}
            className="border-2 border-dashed border-purple/25 rounded-2xl flex flex-col items-center justify-center py-24 px-8 text-center bg-white/50 max-w-4xl mx-auto"
          >
            <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
              <Ticket size={48} className="text-purple/50 mb-6" />
            </motion.div>
            <h3 className="font-display text-2xl font-bold text-text-primary mb-3">Bientôt disponible</h3>
            <p className="text-text-muted max-w-md leading-relaxed">
              La billetterie pour <span className="text-purple">15 minutes</span> ouvrira très prochainement. Restez
              connecté·e·s !
            </p>
          </motion.div>
        )}
      </div>
    </section>
  );
}
