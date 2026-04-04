import React from 'react';
import { motion } from 'framer-motion';
import { Calendar } from 'lucide-react';

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

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          viewport={{ once: true }}
          className="border-2 border-dashed border-teal/25 rounded-2xl flex flex-col items-center justify-center py-24 px-8 text-center bg-white/50"
        >
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' as const }}
          >
            <Calendar size={48} className="text-teal/50 mb-6" />
          </motion.div>
          <h3 className="font-display text-2xl font-bold text-text-primary mb-3">
            Bientôt disponible
          </h3>
          <p className="text-text-muted max-w-md leading-relaxed">
            Les dates d'ateliers et d'événements autour de{' '}
            <span className="text-teal">15 minutes</span> seront annoncées très prochainement.
            Restez connecté·e·s !
          </p>
        </motion.div>
      </div>
    </section>
  );
}
