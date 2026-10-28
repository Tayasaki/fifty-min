import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { ChevronDown } from 'lucide-react';
import afficheTitre from '../../assets/affiche/affiche-titre.jpg';

const MusicalNote = ({ className, delay = 0, symbol = '♪' }: { className: string; delay?: number; symbol?: string }) => (
  <motion.div
    className={`absolute select-none pointer-events-none font-display ${className}`}
    animate={{ y: [-10, 10, -10], opacity: [0.4, 0.75, 0.4] }}
    transition={{ duration: 5 + delay, repeat: Infinity, ease: 'easeInOut' as const, delay }}
  >
    {symbol}
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
  const navigate = useNavigate();
  const goToShow = () => navigate('/spectacle');
  const goToSupport = () => navigate('/soutenir');
  const scrollToTeasers = () => {
    document.querySelector('#teasers')?.scrollIntoView({ behavior: 'smooth' });
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
      <MusicalNote className="text-6xl top-24 left-[8%] text-teal/50" delay={0} />
      <MusicalNote className="text-4xl top-40 right-[10%] text-purple/45" delay={1.5} symbol="♫" />
      <MusicalNote className="text-8xl top-1/3 left-[3%] text-purple/35" delay={0.8} />
      <MusicalNote className="text-5xl bottom-1/3 right-[6%] text-teal/45" delay={2.2} symbol="♬" />
      <MusicalNote className="text-3xl bottom-1/4 left-[15%] text-teal/40" delay={3} symbol="♫" />
      <MusicalNote className="text-7xl top-1/4 right-[20%] text-purple/30" delay={1} />
      <MusicalNote className="text-5xl top-16 right-[35%] text-gold/40" delay={0.5} symbol="♬" />
      <MusicalNote className="text-3xl top-[45%] left-[12%] text-gold/35" delay={1.8} symbol="♫" />
      <MusicalNote className="text-4xl bottom-[20%] right-[18%] text-teal/35" delay={2.8} />
      <MusicalNote className="text-6xl top-[15%] left-[25%] text-purple/30" delay={3.5} symbol="♬" />
      <MusicalNote className="text-3xl bottom-[40%] left-[5%] text-gold/30" delay={0.3} />

      {/* Content */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 pt-24 pb-20 grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-16 items-center">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="text-center lg:text-left"
      >
        {/* Kicker */}
        <motion.p
          variants={itemVariants}
          className="text-teal text-sm font-medium tracking-[0.25em] uppercase mb-6"
        >
          Mélange de Genres · Saison 2026–2027
        </motion.p>

        {/* Title — chromatic offset echoing the poster */}
        <motion.h1
          variants={itemVariants}
          className="font-display font-bold leading-none mb-6 text-text-primary"
        >
          <span className="block text-[clamp(4rem,12vw,8rem)] glitch-text">
            15
          </span>
          <span className="block text-[clamp(2rem,7vw,4.5rem)] -mt-3 glitch-text">
            minutes
          </span>
        </motion.h1>

        <motion.p
          variants={itemVariants}
          className="text-text-muted text-xs sm:text-sm uppercase tracking-[0.18em] mb-8"
        >
          Une comédie musicale originale écrite par{' '}
          <span className="font-semibold text-text-primary">Nora Spycher</span>
        </motion.p>

        {/* Quote */}
        <motion.blockquote
          variants={itemVariants}
          className="font-display italic text-text-muted text-lg md:text-xl mb-4 max-w-2xl mx-auto lg:mx-0"
        >
          « À l'avenir, chacun aura droit à quinze minutes de célébrité. »
        </motion.blockquote>
        <motion.p variants={itemVariants} className="text-text-muted/60 text-sm mb-10">
          — Andy Warhol
        </motion.p>

        {/* Description */}
        <motion.p
          variants={itemVariants}
          className="text-text-muted text-base md:text-lg leading-relaxed mb-10 max-w-2xl mx-auto lg:mx-0"
        >
          La première comédie musicale originale de notre association. Une exploration
          de la célébrité éphémère à l'ère des réseaux sociaux, portée par une vingtaine
          de comédien·ne·s.
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={itemVariants}
          className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start"
        >
          <Button size="lg" onClick={goToShow}>
            Découvrir le spectacle
          </Button>
          <Button size="lg" variant="outline" onClick={goToSupport}>
            Nous soutenir
          </Button>
        </motion.div>
      </motion.div>

      {/* Poster */}
      <motion.figure
        initial={{ opacity: 0, y: 40, rotate: 0 }}
        animate={{ opacity: 1, y: 0, rotate: 2 }}
        whileHover={{ rotate: 0, scale: 1.02 }}
        transition={{ duration: 0.9, ease: 'easeOut' as const, delay: 0.3 }}
        className="relative mx-auto w-full max-w-[20rem] lg:max-w-[26rem]"
      >
        <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-teal/30 via-purple/25 to-transparent blur-2xl" />
        <img
          src={afficheTitre}
          alt="Affiche de 15 minutes : une foule de mains brandissant des téléphones forme un grand cercle sous le titre."
          className="relative rounded-xl shadow-card-hover ring-1 ring-black/5 w-full h-auto"
          width={1080}
          height={1440}
        />
      </motion.figure>
      </div>

      {/* Scroll indicator */}
      <motion.button
        onClick={scrollToTeasers}
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
