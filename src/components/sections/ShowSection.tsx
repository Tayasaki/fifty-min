import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Users, Music, Mic2, BookOpen, X } from 'lucide-react';
import { cn } from '../../lib/utils';

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: 'easeOut' as const },
  }),
};

const themes = [
  'Réseaux sociaux',
  'Identité numérique',
  'Célébrité éphémère',
  'Bad buzz',
  "Pression de l'image",
  'Santé mentale',
  'Algorithmes',
  'Influence',
  'Viralité',
  'Harcèlement en ligne',
  'Vie privée',
  'Désinformation',
];

const themeVariants: ('default' | 'purple' | 'gold')[] = [
  'default', 'purple', 'gold', 'default', 'purple', 'gold', 'default', 'purple',
  'gold', 'default', 'purple', 'gold',
];

interface InfoCard {
  icon: React.ElementType;
  title: string;
  content: string;
  color: string;
  barColor: string;
  bgColor: string;
  borderColor: string;
  details: string[];
}

const infoCards: InfoCard[] = [
  {
    icon: BookOpen,
    title: 'Mise en scène',
    content: "Écrite et mise en scène par Nora « Pâris » Spycher, en collaboration avec les membres de l'association.",
    color: 'text-teal',
    barColor: 'bg-teal/40',
    bgColor: 'bg-teal/10',
    borderColor: 'border-teal/30',
    details: [
      "Un processus de création collaboratif qui implique les interprètes tout au long du projet.",
      "Chaque comédien·ne est accompagné·e par des coachs en jeu théâtral, chant et danse.",
      "Le spectacle s'inscrit dans une démarche pédagogique : ateliers de réflexion sur les réseaux sociaux et collaborations avec des institutions éducatives.",
    ],
  },
  {
    icon: Users,
    title: 'Distribution',
    content: "Une vingtaine de comédien·ne·s accompagné·e·s de coachs en jeu théâtral, chant et danse.",
    color: 'text-purple',
    barColor: 'bg-purple/40',
    bgColor: 'bg-purple/10',
    borderColor: 'border-purple/30',
    details: [
      "Six protagonistes principaux : Riley, Sacha, Noah, Morgan, Andy et Camille.",
      "Une dizaine de personnages secondaires : parents, ami·e·s, managers, marques, fans, haters et influenceur·euse·s.",
      "Une équipe de jeunes interprètes favorisant une forte identification du public.",
    ],
  },
  {
    icon: Music,
    title: 'Musiques',
    content: "Reprises de comédies musicales, de l'univers Disney et de chansons actuelles, majoritairement traduites en français.",
    color: 'text-gold',
    barColor: 'bg-gold/40',
    bgColor: 'bg-gold/10',
    borderColor: 'border-gold/30',
    details: [
      "Un répertoire varié : comédies musicales de Broadway, chansons de l'univers Disney et titres contemporains.",
      "Les titres sont adaptés et traduits en français pour servir le propos dramaturgique et émotionnel.",
      "Un choix musical accessible, dynamique et ancré dans les codes culturels contemporains.",
    ],
  },
  {
    icon: Mic2,
    title: 'Guide narratif',
    content: "Romy, personnage issu de la « vallée du silicone », guide les protagonistes à travers les mécanismes de la visibilité numérique.",
    color: 'text-teal',
    barColor: 'bg-teal/40',
    bgColor: 'bg-teal/10',
    borderColor: 'border-teal/30',
    details: [
      "Romy incarne un regard extérieur sur le monde de l'influence — parfois lucide, parfois cynique.",
      "Son fil narratif structure le spectacle et assure une cohérence dramaturgique à l'ensemble.",
      "À travers elle, le spectacle questionne ce que signifie « être visible » aujourd'hui.",
    ],
  },
];

export default function ShowSection() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveIndex(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex]);

  const activeCard = activeIndex !== null ? infoCards[activeIndex] : null;

  return (
    <section id="spectacle" className="bg-surface py-24">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mb-16"
        >
          <p className="text-teal text-sm font-medium tracking-widest uppercase mb-3">
            Saison 2026–2027
          </p>
          <h2 className="section-title">Le spectacle</h2>
          <div className="divider-teal" />
          <p className="section-subtitle">
            Six jeunes dont la vie bascule lorsqu'une vidéo publiée sans intention particulière
            devient virale. Une plongée dans les réalités du monde de l'influence.
          </p>
        </motion.div>

        {/* Info cards — 2×2 grid, click to open spotlight modal */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          className="grid grid-cols-2 gap-4 mb-16"
        >
          {infoCards.map((card, i) => {
            const Icon = card.icon;
            const isActive = activeIndex === i;
            const isDeemphasized = activeIndex !== null && !isActive;
            return (
              <button
                key={card.title}
                onClick={() => setActiveIndex(i)}
                className="text-left w-full"
              >
                <Card
                  className={cn(
                    'transition-all duration-300 cursor-pointer select-none',
                    isActive
                      ? `${card.bgColor} shadow-card-hover ring-2 ring-offset-2`
                      : isDeemphasized
                        ? 'opacity-40'
                        : 'hover:shadow-card-hover hover:scale-[1.01]'
                  )}
                >
                  <CardHeader className="pb-3">
                    <Icon size={22} className={card.color} />
                    <CardTitle className="text-base mt-2">{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{card.content}</CardDescription>
                    <p className={cn('text-xs mt-3 font-medium', card.color)}>
                      En savoir plus →
                    </p>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </motion.div>

        {/* Spotlight modal */}
        <AnimatePresence>
          {activeCard && (
            <>
              {/* Backdrop */}
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                onClick={() => setActiveIndex(null)}
              />
              {/* Modal */}
              <motion.div
                key="modal"
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 20 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none"
              >
                <div
                  className={cn(
                    'pointer-events-auto w-full max-w-lg rounded-2xl shadow-2xl border p-8',
                    'bg-surface',
                    activeCard.borderColor
                  )}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-3">
                      {(() => { const Icon = activeCard.icon; return <Icon size={24} className={activeCard.color} />; })()}
                      <h3 className="font-display text-xl font-bold text-text-primary">
                        {activeCard.title}
                      </h3>
                    </div>
                    <button
                      onClick={() => setActiveIndex(null)}
                      className="text-text-muted hover:text-text-primary transition-colors ml-4 shrink-0"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  {/* Summary */}
                  <p className="text-text-muted text-sm leading-relaxed mb-6 pb-6 border-b border-black/8">
                    {activeCard.content}
                  </p>

                  {/* Details */}
                  <div className="flex flex-col gap-4">
                    {activeCard.details.map((detail, j) => (
                      <motion.div
                        key={j}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: j * 0.08 + 0.1, duration: 0.3, ease: 'easeOut' }}
                        className="flex items-start gap-3"
                      >
                        <div className={`mt-1.5 w-0.5 h-4 rounded-full shrink-0 ${activeCard.barColor}`} />
                        <p className="text-sm text-text-muted leading-relaxed">{detail}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Themes */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <h3 className="font-display text-2xl font-bold text-text-primary mb-2">
            Thèmes abordés
          </h3>
          <p className="text-text-muted text-sm mb-6">
            Un outil artistique et pédagogique ancré dans les réalités contemporaines.
          </p>
          <div className="flex flex-wrap gap-2">
            {themes.map((theme, i) => (
              <motion.div
                key={theme}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                viewport={{ once: true }}
              >
                <Badge variant={themeVariants[i % themeVariants.length]} className="text-xs">
                  {theme}
                </Badge>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Extended description */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="mt-16 p-8 rounded-2xl glass-card border border-teal/15"
        >
          <p className="text-text-muted leading-relaxed text-base md:text-lg">
            Sans jamais nommer explicitement de plateformes ou de figures réelles,{' '}
            <span className="text-teal font-medium">15 minutes</span> s'inspire de situations
            largement reconnaissables : good buzz, bad buzz, commentaires publics, jugement
            collectif, disparition soudaine de la visibilité ou pression de l'algorithme.
            Loin de condamner les réseaux sociaux, le projet cherche à questionner ce que
            signifie{' '}
            <span className="text-purple italic">« être visible »</span> aujourd'hui.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
