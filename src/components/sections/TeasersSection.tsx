import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Mic2, Heart, Calendar, Ticket, Gift, MessageCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { cn } from '../../lib/utils';

interface Teaser {
  icon: React.ElementType;
  title: string;
  description: string;
  to: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const teasers: Teaser[] = [
  {
    icon: Mic2,
    title: 'Le spectacle',
    description: "Six jeunes, une vidéo virale, et tout qui bascule. L'histoire au cœur du projet.",
    to: '/spectacle',
    color: 'text-teal',
    bgColor: 'bg-teal/10',
    borderColor: 'border-teal/20',
  },
  {
    icon: Heart,
    title: "L'association",
    description: "De 2019 à aujourd'hui — qui nous sommes, ce qu'on défend.",
    to: '/association',
    color: 'text-purple',
    bgColor: 'bg-purple/10',
    borderColor: 'border-purple/20',
  },
  {
    icon: Calendar,
    title: 'Ateliers & événements',
    description: "Blind tests, soirées, rencontres — les rendez-vous à venir.",
    to: '/agenda',
    color: 'text-gold',
    bgColor: 'bg-gold/10',
    borderColor: 'border-gold/20',
  },
  {
    icon: Ticket,
    title: 'Billetterie',
    description: "Février et mars 2027 — réservez votre place pour les représentations.",
    to: '/billetterie',
    color: 'text-teal',
    bgColor: 'bg-teal/10',
    borderColor: 'border-teal/20',
  },
  {
    icon: Gift,
    title: 'Nous soutenir',
    description: "Cagnotte, virement, coup de main : toutes les façons de nous accompagner.",
    to: '/soutenir',
    color: 'text-purple',
    bgColor: 'bg-purple/10',
    borderColor: 'border-purple/20',
  },
  {
    icon: MessageCircle,
    title: 'Contact',
    description: "Une question, une idée, l'envie de rejoindre l'aventure ? Écrivez-nous.",
    to: '/contact',
    color: 'text-gold',
    bgColor: 'bg-gold/10',
    borderColor: 'border-gold/20',
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: 'easeOut' as const },
  }),
};

export default function TeasersSection() {
  return (
    <section id="teasers" className="bg-surface py-24">
      <div className="max-w-6xl mx-auto px-6">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mb-12 text-center"
        >
          <p className="text-teal text-sm font-medium tracking-widest uppercase mb-3">
            Découvrir
          </p>
          <h2 className="section-title">Tout ce qu'il faut savoir</h2>
          <div className="divider-teal mx-auto" />
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {teasers.map((teaser, i) => {
            const Icon = teaser.icon;
            return (
              <motion.div
                key={teaser.to}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
              >
                <Link to={teaser.to} className="block h-full group">
                  <Card className="h-full transition-all duration-300 group-hover:shadow-card-hover group-hover:-translate-y-1">
                    <CardHeader>
                      <div
                        className={cn(
                          'h-11 w-11 rounded-lg flex items-center justify-center mb-3 border',
                          teaser.bgColor,
                          teaser.borderColor
                        )}
                      >
                        <Icon size={20} className={teaser.color} />
                      </div>
                      <CardTitle className="text-lg">{teaser.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="mb-4">{teaser.description}</CardDescription>
                      <span
                        className={cn(
                          'text-xs font-medium transition-transform inline-block group-hover:translate-x-1',
                          teaser.color
                        )}
                      >
                        En savoir plus →
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
