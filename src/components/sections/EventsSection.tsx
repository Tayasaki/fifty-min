import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, MapPin } from 'lucide-react';
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

const events: EventItem[] = [
  {
    title: 'Uni Art Fait Son Live',
    description:
      'Cet événement est organisé par Uni Art et Mélange de Genres — venez participer à un blind test plein de surprises et tentez de remporter des prix ! On espère vous voir nombreux·ses !',
    date: '1er mai 2026',
    time: '19h00',
    location: 'Floky Bar',
    locationDetail: 'Sous-sol',
    formUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSfuMoK6XWqs8iVJAWbBrywL5q2thbpmJTBg3lVJOu-1FWJaeA/viewform',
  },
];

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
