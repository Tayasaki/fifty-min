import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Calendar, Clock, MapPin, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';

interface EventItem {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  locationDetail: string;
  formUrl: string;
}

// Add upcoming events here; an announcement card is shown while the list is empty.
const events: EventItem[] = [];

export default function EventsSection() {
  return (
    <section id="ateliers" className="bg-background py-24">
      <div className="max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center"
        >
          <p className="text-teal text-sm font-medium tracking-widest uppercase mb-3">
            Agenda
          </p>
          <h2 className="section-title">Ateliers & Événements</h2>
          <div className="w-16 h-1 rounded-full bg-teal mx-auto mt-4 mb-12" />
        </motion.div>

        {events.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto bg-white/70 backdrop-blur-sm rounded-2xl p-10 shadow-card border border-black/6 text-center flex flex-col items-center gap-4"
          >
            <Sparkles size={36} className="text-teal" />
            <h3 className="font-display text-2xl font-bold text-text-primary">De nouveaux rendez-vous arrivent</h3>
            <p className="text-text-muted text-sm leading-relaxed max-w-md">
              Ateliers, blind tests, soirées… D'autres événements sont en préparation d'ici les représentations de{' '}
              <span className="text-teal font-medium">15 minutes</span>. Revenez bientôt ou suivez-nous pour ne rien
              manquer !
            </p>
            <Button variant="outline" size="lg" className="rounded-full mt-2" asChild>
              <Link to="/contact">Nous contacter</Link>
            </Button>
          </motion.div>
        )}

        <div className="flex flex-col gap-6 max-w-2xl mx-auto">
          {events.map((event, i) => (
            <motion.div
              key={event.title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: i * 0.12 }}
              viewport={{ once: true }}
              whileHover={{ y: -4 }}
              className="bg-white/70 backdrop-blur-sm rounded-2xl p-8 shadow-card hover:shadow-card-hover transition-shadow flex flex-col gap-5 border border-black/6"
            >
              {/* Title */}
              <h3 className="font-display text-2xl font-bold text-text-primary leading-snug">
                {event.title}
              </h3>

              {/* Description */}
              <p className="text-text-muted text-sm leading-relaxed">
                {event.description}
              </p>

              {/* Details */}
              <ul className="flex flex-col gap-2.5">
                <li className="flex items-center gap-2.5 text-text-muted text-sm">
                  <Calendar size={14} className="text-teal shrink-0" />
                  {event.date}
                </li>
                <li className="flex items-center gap-2.5 text-text-muted text-sm">
                  <Clock size={14} className="text-teal shrink-0" />
                  {event.time}
                </li>
                <li className="flex items-center gap-2.5 text-text-muted text-sm">
                  <MapPin size={14} className="text-teal shrink-0" />
                  <span>
                    {event.location}
                    <span className="text-text-muted/60"> — {event.locationDetail}</span>
                  </span>
                </li>
              </ul>

              {/* CTA */}
              <div className="mt-1">
                <Button variant="default" size="lg" className="rounded-full w-full" asChild>
                  <a href={event.formUrl} target="_blank" rel="noopener noreferrer">
                    S'inscrire via le formulaire
                  </a>
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
