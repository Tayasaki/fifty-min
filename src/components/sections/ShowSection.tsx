import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Users, Music, Mic2, BookOpen } from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: 'easeOut' as const },
  }),
};

// Alternating teal (#7BB7AA) / purple (#B8A0BB) — half each
const characters: { name: string; variant: 'default' | 'purple' }[] = [
  { name: 'Riley',   variant: 'default' },
  { name: 'Sacha',   variant: 'purple'  },
  { name: 'Noah',    variant: 'default' },
  { name: 'Morgan',  variant: 'purple'  },
  { name: 'Andy',    variant: 'default' },
  { name: 'Camille', variant: 'purple'  },
];

const themes = [
  'Réseaux sociaux',
  'Identité numérique',
  'Célébrité éphémère',
  'Bad buzz',
  "Pression de l'image",
  'Santé mentale',
  'Algorithmes',
  'Influence',
];

const infoCards = [
  {
    icon: BookOpen,
    title: 'Mise en scène',
    content: "Écrite et mise en scène par Nora « Pâris » Spycher, en collaboration avec les membres de l'association.",
    color: 'text-teal',
  },
  {
    icon: Users,
    title: 'Distribution',
    content: "Une vingtaine de comédien·ne·s accompagné·e·s de coachs en jeu théâtral, chant et danse.",
    color: 'text-purple',
  },
  {
    icon: Music,
    title: 'Musiques',
    content: "Reprises de comédies musicales, de l'univers Disney et de chansons actuelles, majoritairement traduites en français.",
    color: 'text-gold',
  },
  {
    icon: Mic2,
    title: 'Guide narratif',
    content: "Romy, personnage issu de la « vallée du silicone », guide les protagonistes à travers les mécanismes de la visibilité numérique.",
    color: 'text-teal',
  },
];

export default function ShowSection() {
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
          <p className="section-subtitle max-w-2xl">
            Six jeunes dont la vie bascule lorsqu'une vidéo publiée sans intention particulière
            devient virale. Une plongée dans les réalités du monde de l'influence.
          </p>
        </motion.div>

        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {infoCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.title}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                whileHover={{ y: -4 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <Card className="h-full hover:shadow-card-hover transition-shadow duration-300">
                  <CardHeader className="pb-3">
                    <Icon size={22} className={card.color} />
                    <CardTitle className="text-base mt-2">{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{card.content}</CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Characters + themes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {/* Characters — alternating teal / purple */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <h3 className="font-display text-2xl font-bold text-text-primary mb-2">
              Les personnages
            </h3>
            <p className="text-text-muted text-sm mb-6">
              Six jeunes propulsé·e·s sous les projecteurs après une vidéo virale.
            </p>
            <div className="flex flex-wrap gap-3">
              {characters.map((char, i) => (
                  <motion.div
                    key={char.name}
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.08, duration: 0.4 }}
                    viewport={{ once: true }}
                    whileHover={{ scale: 1.06, y: -2 }}
                  >
                    <Badge variant={char.variant} className="text-sm px-4 py-1.5">
                      {char.name}
                    </Badge>
                  </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Themes */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
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
                  <Badge variant="muted" className="text-xs">
                    {theme}
                  </Badge>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

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
