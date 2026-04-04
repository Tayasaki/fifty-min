import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '../ui/button';
import { ChevronDown } from 'lucide-react';

const MusicalNote = ({ className, delay = 0 }: { className: string; delay?: number }) => (
  <motion.div
    className={`absolute select-none pointer-events-none font-display ${className}`}
    animate={{ y: [-10, 10, -10], opacity: [0.25, 0.55, 0.25] }}
    transition={{ duration: 5 + delay, repeat: Infinity, ease: 'easeInOut' as const, delay }}
  >
    ♪
  </motion.div>
);

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' as const } },
};

export default function HeroSection() {
  const scrollToShow = () => {
    document.querySelector('#spectacle')?.scrollIntoView({ behavior: 'smooth' });
  };
  const scrollToSupport = () => {
    document.querySelector('#soutenir')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      id="accueil"
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-background"
    >
      {/* Soft gradient overlays */}
      <div className="absolute inset-0 bg-spotlight pointer-events-none" />
      <div className="absolute inset-0 bg-spotlight-purple pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 100%, rgba(184,160,187,0.08) 0%, transparent 70%)',
        }}
      />

      {/* Decorative musical notes */}
      <MusicalNote className="text-6xl top-24 left-[8%] text-teal/30" delay={0} />
      <MusicalNote className="text-4xl top-40 right-[10%] text-purple/25" delay={1.5} />
      <MusicalNote className="text-8xl top-1/3 left-[3%] text-purple/20" delay={0.8} />
      <MusicalNote className="text-5xl bottom-1/3 right-[6%] text-teal/25" delay={2.2} />
      <MusicalNote className="text-3xl bottom-1/4 left-[15%] text-teal/20" delay={3} />
      <MusicalNote className="text-7xl top-1/4 right-[20%] text-purple/15" delay={1} />

      {/* Content */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 text-center px-6 max-w-4xl mx-auto"
      >
        {/* Kicker */}
        <motion.p
          variants={itemVariants}
          className="text-teal text-sm font-medium tracking-[0.25em] uppercase mb-6"
        >
          Mélange de Genres · Saison 2026–2027
        </motion.p>

        {/* Title */}
        <motion.h1
          variants={itemVariants}
          className="font-display font-bold leading-none mb-6"
        >
          <span className="block text-[clamp(4rem,14vw,9rem)] teal-gradient-text">
            15
          </span>
          <span className="block text-[clamp(2rem,8vw,5rem)] text-text-primary -mt-4">
            minutes
          </span>
        </motion.h1>

        {/* Quote */}
        <motion.blockquote
          variants={itemVariants}
          className="font-display italic text-text-muted text-lg md:text-xl mb-4 max-w-2xl mx-auto"
        >
          « À l'avenir, chacun aura droit à quinze minutes de célébrité. »
        </motion.blockquote>
        <motion.p variants={itemVariants} className="text-text-muted/60 text-sm mb-10">
          — Andy Warhol
        </motion.p>

        {/* Description */}
        <motion.p
          variants={itemVariants}
          className="text-text-muted text-base md:text-lg leading-relaxed mb-12 max-w-2xl mx-auto"
        >
          La première comédie musicale originale de notre association. Une exploration
          de la célébrité éphémère à l'ère des réseaux sociaux, portée par une vingtaine
          de comédien·ne·s.
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={itemVariants}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Button size="lg" onClick={scrollToShow}>
            Découvrir le spectacle
          </Button>
          <Button size="lg" variant="outline" onClick={scrollToSupport}>
            Nous soutenir
          </Button>
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.button
        onClick={scrollToShow}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-text-muted hover:text-teal transition-colors"
        aria-label="Défiler vers le bas"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' as const }}
        >
          <ChevronDown size={28} />
        </motion.div>
      </motion.button>
    </section>
  );
}
