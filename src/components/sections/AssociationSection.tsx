import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Heart, Lightbulb, Users } from 'lucide-react';
import logo from '../../assets/logo.jpg';

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.12, ease: 'easeOut' as const },
  }),
};

interface Mission {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  barColor: string;
  details: string[];
}

const missions: Mission[] = [
  {
    icon: Heart,
    title: 'Valoriser les artistes émergents',
    description: "Offrir une scène et une visibilité aux jeunes créateur·rice·s de notre région.",
    color: 'text-teal',
    barColor: 'bg-teal/40',
    details: [
      "Porter des projets incarnés par des interprètes locaux, dans un cadre bienveillant et exigeant.",
      "Créer des conditions favorables à l'épanouissement artistique, avec l'appui de coachs en jeu, chant et danse.",
      "Encourager les vocations et soutenir les premières expériences de scène.",
    ],
  },
  {
    icon: Lightbulb,
    title: "Encourager l'esprit critique",
    description: "Utiliser l'art comme outil de réflexion sur les enjeux contemporains.",
    color: 'text-gold',
    barColor: 'bg-gold/40',
    details: [
      "Aborder des thèmes de société — réseaux sociaux, identité numérique, célébrité éphémère — à travers un prisme artistique et accessible.",
      "Proposer des ateliers de discussion et de réflexion en complément des représentations.",
      "Sensibiliser le public jeune et adulte aux réalités du monde numérique.",
    ],
  },
  {
    icon: Users,
    title: 'Créer des ponts',
    description: 'Relier création artistique, éducation et réalités sociales actuelles.',
    color: 'text-purple',
    barColor: 'bg-purple/40',
    details: [
      "Développer des collaborations avec des institutions éducatives, culturelles et des partenaires engagé·e·s.",
      "Faire de la comédie musicale un outil de dialogue entre générations et milieux différents.",
      "S'inscrire dans une démarche de transmission durable, au-delà de chaque projet.",
    ],
  },
];

export default function AssociationSection() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <section id="association" className="bg-surface-2 py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Text */}
          <div>
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-80px' }}
            >
              <p className="text-purple text-sm font-medium tracking-widest uppercase mb-3">
                Qui sommes-nous
              </p>
              <h2 className="section-title">L'association</h2>
              <div className="w-16 h-1 rounded-full bg-purple mt-4 mb-8" />
            </motion.div>

            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={1}
              className="space-y-5 text-text-muted leading-relaxed"
            >
              <p>
                <span className="text-purple font-medium">Mélange de Genres</span> a vu le
                jour en <span className="text-text-primary">2019</span>, sous l'impulsion d'un
                groupe d'amis musiciens, afin de promouvoir la musique locale à travers un
                festival annuel.
              </p>
              <p>
                Après la crise COVID et plusieurs départs, l'association a vécu une grande pause.
                C'est en <span className="text-text-primary">décembre 2025</span> qu'elle sort
                de son hibernation avec un nouveau but : développer des projets artistiques
                mêlant <span className="text-purple font-medium">création, transmission et réflexion</span>{' '}
                autour des enjeux contemporains.
              </p>
              <p>
                L'association défend une approche{' '}
                <span className="text-teal font-medium">inclusive, accessible et engagée</span> de la culture,
                en proposant des formes artistiques populaires comme la comédie musicale en
                tant qu'outils de dialogue et d'expression collective.
              </p>
            </motion.div>
          </div>

          {/* Logo + missions */}
          <div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: 'easeOut' as const }}
              viewport={{ once: true }}
              className="flex justify-center mb-10"
            >
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-teal/10 blur-3xl scale-150" />
                <div className="relative h-48 w-48 rounded-full bg-white flex items-center justify-center shadow-card overflow-hidden">
                  <img
                    src={logo}
                    alt="Mélange de Genres"
                    className="h-full w-full object-contain"
                    style={{ mixBlendMode: 'multiply' }}
                  />
                </div>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 gap-4">
              {missions.map((mission, i) => {
                const Icon = mission.icon;
                const isHovered = hoveredIndex === i;
                return (
                  <motion.div
                    key={mission.title}
                    custom={i}
                    variants={fadeUp}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    onMouseEnter={() => setHoveredIndex(i)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <Card className="transition-shadow duration-200 hover:shadow-card-hover">
                      <CardHeader className="pb-2 flex-row items-start gap-3 space-y-0">
                        <Icon size={18} className={`${mission.color} mt-0.5 shrink-0`} />
                        <CardTitle className="text-sm">{mission.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="text-xs pl-7">{mission.description}</CardDescription>
                        <AnimatePresence initial={false}>
                          {isHovered && (
                            <motion.div
                              key="details"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{
                                height: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
                                opacity: { duration: 0.25 },
                              }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 pt-3 border-t border-black/6 flex flex-col gap-2.5 pl-7">
                                {mission.details.map((detail, j) => (
                                  <motion.div
                                    key={j}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: j * 0.07 + 0.1, duration: 0.3, ease: 'easeOut' }}
                                    className="flex items-start gap-3"
                                  >
                                    <div className={`mt-1 w-0.5 self-stretch rounded-full shrink-0 ${mission.barColor}`} />
                                    <p className="text-sm text-text-muted leading-relaxed">{detail}</p>
                                  </motion.div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
