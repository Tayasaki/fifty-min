import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '../ui/button';
import { MapPin, Clock, Ticket } from 'lucide-react';

const venues = [
  {
    name: 'Théâtre Le Monique',
    location: 'Cointrin',
    dates: [
      'Vendredi 19 février — 20h30',
      'Samedi 20 février — 20h30',
      'Dimanche 21 février — 20h30',
    ],
    ticketUrl: '#',
  },
  {
    name: 'Théâtre de la Julienne',
    location: 'Plan-les-Ouates',
    dates: [
      'Jeudi 11 mars — 20h30',
      'Vendredi 12 mars — 20h30',
      'Samedi 13 mars — 20h30',
      'Dimanche 14 mars — 20h30',
    ],
    ticketUrl: '#',
  },
];

const showTicketing = process.env.REACT_APP_SHOW_TICKETING === 'true';

export default function TicketingSection() {
  return (
    <section
      id="billetterie"
      className="py-24 bg-background"
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <p className="text-purple text-sm font-medium tracking-widest uppercase mb-3">
            Réservations
          </p>
          <h2 className="section-title">
            Billetterie
          </h2>
          <div className="w-16 h-1 rounded-full bg-purple mx-auto mt-4" />
        </motion.div>

        {showTicketing ? (
          /* Venue cards */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {venues.map((venue, i) => (
              <motion.div
                key={venue.name}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: i * 0.12 }}
                viewport={{ once: true }}
                whileHover={{ y: -6 }}
                className="bg-white/70 backdrop-blur-sm rounded-2xl p-8 shadow-card hover:shadow-card-hover transition-shadow flex flex-col gap-6 border border-black/6"
              >
                {/* Venue name */}
                <div>
                  <div className="flex items-start gap-2 mb-1">
                    <MapPin size={15} className="text-text-muted mt-0.5 shrink-0" />
                    <span className="text-text-muted text-xs uppercase tracking-wide">
                      {venue.location}
                    </span>
                  </div>
                  <h3 className="font-display text-xl font-bold text-text-primary uppercase leading-snug">
                    {venue.name}
                  </h3>
                </div>

                {/* Dates */}
                <ul className="flex flex-col gap-2">
                  {venue.dates.map((date) => (
                    <li key={date} className="flex items-center gap-2 text-text-muted text-sm">
                      <Clock size={13} className="text-purple shrink-0" />
                      {date}
                    </li>
                  ))}
                </ul>

                {/* Button */}
                <div className="mt-auto">
                  <Button variant="dark" size="lg" className="rounded-full w-full" asChild>
                    <a href={venue.ticketUrl} target="_blank" rel="noopener noreferrer">
                      Billetterie
                    </a>
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            viewport={{ once: true }}
            className="border-2 border-dashed border-purple/25 rounded-2xl flex flex-col items-center justify-center py-24 px-8 text-center bg-white/50 max-w-4xl mx-auto"
          >
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Ticket size={48} className="text-purple/50 mb-6" />
            </motion.div>
            <h3 className="font-display text-2xl font-bold text-text-primary mb-3">
              Bientôt disponible
            </h3>
            <p className="text-text-muted max-w-md leading-relaxed">
              La billetterie pour{' '}
              <span className="text-purple">15 minutes</span> ouvrira très prochainement.
              Restez connecté·e·s !
            </p>
          </motion.div>
        )}
      </div>
    </section>
  );
}
