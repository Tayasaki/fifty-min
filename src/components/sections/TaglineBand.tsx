import React from 'react';
import { motion } from 'framer-motion';

// Glowing "phone screens" scattered like on the poster
const screens = [
  { top: '18%', left: '6%', color: 'red', rotate: -12 },
  { top: '62%', left: '12%', color: 'blue', rotate: 8 },
  { top: '30%', left: '22%', color: 'blue', rotate: -4 },
  { top: '70%', left: '34%', color: 'red', rotate: 14 },
  { top: '14%', left: '46%', color: 'red', rotate: 6 },
  { top: '74%', left: '58%', color: 'blue', rotate: -10 },
  { top: '22%', left: '70%', color: 'blue', rotate: 12 },
  { top: '58%', left: '80%', color: 'red', rotate: -6 },
  { top: '16%', left: '90%', color: 'red', rotate: 10 },
  { top: '68%', left: '94%', color: 'blue', rotate: -14 },
];

export default function TaglineBand() {
  return (
    <section className="relative overflow-hidden bg-[#2E2C40] py-16 md:py-20">
      {screens.map((s, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute w-3 h-4 md:w-4 md:h-6 rounded-[3px]"
          style={{
            top: s.top,
            left: s.left,
            rotate: s.rotate,
            background: s.color === 'red' ? '#E0464F' : '#6FC6E8',
            boxShadow:
              s.color === 'red'
                ? '0 0 18px 8px rgba(224,70,79,0.35)'
                : '0 0 18px 8px rgba(111,198,232,0.35)',
          }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 3 + (i % 4), repeat: Infinity, ease: 'easeInOut' as const, delay: i * 0.3 }}
        />
      ))}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        viewport={{ once: true }}
        className="relative z-10 text-center px-6"
      >
        <p className="text-white/85 font-semibold uppercase tracking-[0.22em] text-base md:text-2xl leading-relaxed">
          Une vidéo,
          <br />
          un million de vues…
        </p>
        <p className="mt-4 text-white font-bold uppercase tracking-[0.22em] text-2xl md:text-4xl glitch-text">
          Et après ?
        </p>
      </motion.div>
    </section>
  );
}
