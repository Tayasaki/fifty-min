import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/** Reservations open on 15 November 2026 at midnight, Geneva time (CET). */
export const RESERVATIONS_OPEN_AT = new Date('2026-11-15T00:00:00+01:00');

// Glowing "phone screens" around the central phone, like the hands on the poster
const screens = [
  { top: '12%', left: '14%', color: 'red', rotate: -14 },
  { top: '30%', left: '82%', color: 'blue', rotate: 10 },
  { top: '70%', left: '10%', color: 'blue', rotate: 8 },
  { top: '82%', left: '76%', color: 'red', rotate: -8 },
  { top: '48%', left: '4%', color: 'red', rotate: 12 },
  { top: '8%', left: '70%', color: 'red', rotate: 6 },
  { top: '60%', left: '90%', color: 'blue', rotate: -12 },
];

function remainingParts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    jours: Math.floor(total / 86400),
    heures: Math.floor((total % 86400) / 3600),
    min: Math.floor((total % 3600) / 60),
    sec: total % 60,
  };
}

/** Poster-styled banner: countdown while ticketing is closed, invitation once it is open. */
export default function ReservationsCountdown({ open = false }: { open?: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const parts = remainingParts(RESERVATIONS_OPEN_AT.getTime() - now);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true }}
      className="relative overflow-hidden rounded-2xl bg-[#2E2C40] text-white grid md:grid-cols-[1fr_16rem] items-stretch max-w-4xl mx-auto"
    >
      <div className="p-8 md:p-10 text-center md:text-left">
        {open ? (
          <>
            <p className="uppercase tracking-[0.2em] text-white/70 text-sm mb-2">Billetterie</p>
            <p className="text-3xl md:text-4xl font-bold mb-4">Réservations ouvertes</p>
            <p className="text-white/80 text-sm md:text-base leading-relaxed mb-6 max-w-md mx-auto md:mx-0">
              Choisissez une date ci-dessous, indiquez votre email, puis confirmez grâce au lien reçu par email.
            </p>
          </>
        ) : (
          <>
            <p className="uppercase tracking-[0.2em] text-white/70 text-sm mb-2">Réservations ouvertes dès le</p>
            <p className="text-3xl md:text-4xl font-bold mb-6">15 novembre 2026</p>

            <div className="flex gap-2 sm:gap-3 mb-6 justify-center md:justify-start">
              {Object.entries(parts).map(([label, value]) => (
                <div key={label} className="bg-white/10 rounded-lg w-16 sm:w-[4.5rem] py-2 text-center">
                  <div className="text-2xl font-bold tabular-nums">{String(value).padStart(2, '0')}</div>
                  <div className="text-[10px] uppercase tracking-widest text-white/60">{label}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-xs sm:text-sm uppercase tracking-[0.15em] text-white/80 leading-relaxed">
          Entrée libre · Réservation recommandée · Chapeau à la sortie
        </p>
      </div>

      {/* Phone surrounded by glowing screens */}
      <div aria-hidden className="relative hidden md:flex items-center justify-center">
        {screens.map((s, i) => (
          <motion.span
            key={i}
            className="absolute w-3 h-[1.1rem] rounded-[3px]"
            style={{
              top: s.top,
              left: s.left,
              rotate: s.rotate,
              background: s.color === 'red' ? '#E0464F' : '#6FC6E8',
              boxShadow:
                s.color === 'red' ? '0 0 16px 7px rgba(224,70,79,0.35)' : '0 0 16px 7px rgba(111,198,232,0.35)',
            }}
            animate={{ opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 3 + (i % 3), repeat: Infinity, ease: 'easeInOut' as const, delay: i * 0.4 }}
          />
        ))}

        <motion.div
          animate={{ y: [-4, 4, -4] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' as const }}
          className="relative w-28 h-52 rounded-[1.75rem] border-2 border-white/30 bg-gradient-to-b from-[#3A3852] to-[#25233A] shadow-[0_0_40px_rgba(111,198,232,0.15)] flex flex-col items-center justify-center rotate-[-6deg]"
        >
          <span className="absolute top-2.5 w-8 h-1.5 rounded-full bg-white/20" />
          <span className="font-display font-bold text-5xl leading-none glitch-text">15</span>
          <span className="font-display font-bold text-lg leading-none mt-1 glitch-text">minutes</span>
          <span className="absolute bottom-3 w-10 h-1 rounded-full bg-white/25" />
        </motion.div>
      </div>
    </motion.div>
  );
}
