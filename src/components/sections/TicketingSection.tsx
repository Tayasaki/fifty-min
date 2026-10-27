import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../ui/button';
import { MapPin, Clock, MailCheck, AlertCircle, Accessibility } from 'lucide-react';
import { MAX_TICKETS_PER_EMAIL, SHOWS, VENUES, type Show, getVenue, showStart } from '../../config/shows';
import ReservationsCountdown from './ReservationsCountdown';
import { cn } from '../../lib/utils';
import { suggestEmail } from '../../lib/emailTypos';

const showTicketing = process.env.REACT_APP_SHOW_TICKETING === 'true';

type Availability = Record<string, number>;

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; reservationId: string; expiresAt: number; email: string; quantity: number; show: Show };

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function formatDeadline(ms: number): string {
  return new Date(ms).toLocaleString('fr-CH', {
    timeZone: 'Europe/Zurich',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
  const [emailConfirm, setEmailConfirm] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  const venue = getVenue(show.venueId);
  const maxQuantity = Math.max(1, Math.min(MAX_TICKETS_PER_EMAIL, remaining ?? MAX_TICKETS_PER_EMAIL));

  useEffect(() => {
    if (quantity > maxQuantity) setQuantity(maxQuantity);
  }, [quantity, maxQuantity]);

  const suggestion = emailTouched ? suggestEmail(email.trim()) : null;
  const emailMismatch = confirmTouched && emailConfirm !== '' && !sameEmail(email, emailConfirm);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sameEmail(email, emailConfirm)) {
      setConfirmTouched(true);
      return;
    }
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
      onSuccess({ kind: 'success', reservationId: data.reservationId, expiresAt: data.expiresAt, email, quantity, show });
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
        <p className="text-text-muted text-sm mt-1">Ouverture des portes {show.doorsOpen}</p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm text-text-primary">
        Nom et prénom
        <input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-text-primary">
        Email
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          className={inputClass}
        />
        {suggestion && (
          <span className="text-xs text-text-muted">
            Vouliez-vous dire{' '}
            <button
              type="button"
              onClick={() => {
                if (sameEmail(emailConfirm, email)) setEmailConfirm(suggestion);
                setEmail(suggestion);
              }}
              className="text-teal-deep font-medium underline underline-offset-2"
            >
              {suggestion}
            </button>{' '}
            ?
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-text-primary">
        Confirmez votre email
        <input
          required
          type="email"
          autoComplete="email"
          value={emailConfirm}
          onChange={(e) => setEmailConfirm(e.target.value)}
          onBlur={() => setConfirmTouched(true)}
          aria-invalid={emailMismatch}
          className={cn(inputClass, emailMismatch && 'border-red-400 focus:ring-red-200')}
        />
        {emailMismatch && <span className="text-xs text-red-700">Les deux adresses email ne correspondent pas.</span>}
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

// Same colour blocks as the poster's date visuals
const VENUE_BAND_COLORS: Record<string, string> = {
  monique: 'bg-[#D8C9DA]',
  julienne: 'bg-[#A9CFD2]',
};

const MONTH_FMT = new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });

/** "Du 11 au 14 mars 2027", derived from the shows config so it never drifts. */
function venueDateRange(venueId: string): string {
  const dates = SHOWS.filter((s) => s.venueId === venueId).map(showStart);
  if (dates.length === 0) return '';
  const first = dates[0];
  const last = dates[dates.length - 1];
  const day = (d: Date) => Number(d.toLocaleString('fr-CH', { day: 'numeric', timeZone: 'Europe/Zurich' }));
  return `Du ${day(first)} au ${day(last)} ${MONTH_FMT.format(last)}`;
}

function VenueDateBand({ venueId }: { venueId: string }) {
  return (
    <div className={cn('px-6 py-5', VENUE_BAND_COLORS[venueId] ?? 'bg-surface-2')}>
      <p className="text-xl md:text-2xl font-bold text-text-primary uppercase leading-tight">{venueDateRange(venueId)}</p>
    </div>
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
        </motion.div>

        {showTicketing ? (
          <>
            <ReservationsCountdown open />

            {/* Venue cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mt-8">
              {VENUES.map((venue, i) => (
                <motion.div
                  key={venue.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: i * 0.12 }}
                  viewport={{ once: true }}
                  className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-card flex flex-col border border-black/6 overflow-hidden"
                >
                  <VenueDateBand venueId={venue.id} />
                  <div className="p-6 flex flex-col gap-5">
                  <div>
                    <h3 className="font-semibold uppercase tracking-wide text-sm text-text-primary">
                      {venue.name} · {venue.location}
                    </h3>
                    <p className="flex items-start gap-1.5 text-text-muted text-sm mt-2">
                      <MapPin size={14} className="mt-0.5 shrink-0" />
                      {venue.address}
                    </p>
                    <p className="flex items-center gap-1.5 text-teal-deep text-xs mt-1">
                      <Accessibility size={13} className="shrink-0" />
                      {venue.accessibility}
                    </p>
                    <div className="h-1 w-20 bg-[#9497AE] rounded mt-4" />
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
                  </div>
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
                    <MailCheck size={40} className="text-teal" />
                    <h3 className="font-display text-2xl font-bold text-text-primary">Plus qu'une étape !</h3>
                    <p className="text-text-muted text-sm leading-relaxed">
                      {success.quantity} place{success.quantity > 1 ? 's' : ''} pour le {success.show.label.toLowerCase()}{' '}
                      {success.quantity > 1 ? 'vous sont réservées' : 'vous est réservée'}.
                    </p>
                    <p className="text-text-muted text-sm leading-relaxed">
                      Un email vient d'être envoyé à <strong className="text-text-primary">{success.email}</strong>.
                      Cliquez sur le lien qu'il contient <strong className="text-text-primary">avant le {formatDeadline(success.expiresAt)}</strong>{' '}
                      pour confirmer votre réservation, sinon les places seront libérées. Pensez à vérifier vos spams.
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
          <>
            <ReservationsCountdown />

            {/* Dates preview, in the poster's colours */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mt-8">
              {VENUES.map((venue, i) => (
                <motion.div
                  key={venue.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: i * 0.12 }}
                  viewport={{ once: true }}
                  className="bg-white rounded-2xl shadow-card border border-black/6 overflow-hidden"
                >
                  <VenueDateBand venueId={venue.id} />
                  <div className="p-6">
                    <p className="font-semibold uppercase tracking-wide text-sm text-text-primary">
                      {venue.name} · {venue.location}
                    </p>
                    <div className="h-1 w-20 bg-[#9497AE] rounded my-4" />
                    <ul className="flex flex-col gap-1.5">
                      {SHOWS.filter((s) => s.venueId === venue.id).map((show) => (
                        <li key={show.id} className="flex items-center gap-2 text-sm text-text-muted">
                          <Clock size={13} className="text-purple shrink-0" />
                          {show.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
