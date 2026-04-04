import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Heart, ExternalLink, Copy, Check } from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: 'easeOut' as const },
  }),
};

const volunteerRoles = [
  'Costumes',
  'Accessoires',
  'Maquillage',
  'Décors',
  'Coaching Chant',
  'Administratif',
  'Recherche de Sponsoring',
  'Coup de main général',
];

export default function SupportSection() {
  const [copied, setCopied] = React.useState(false);
  const iban = 'CH08 0900 0000 1685 1713 2';

  const copyIban = () => {
    navigator.clipboard.writeText(iban.replace(/\s/g, '')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section id="soutenir" className="bg-surface py-24">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="text-center mb-16"
        >
          <p className="text-gold text-sm font-medium tracking-widest uppercase mb-3">
            Rejoins l'aventure
          </p>
          <h2 className="section-title">Nous soutenir</h2>
          <div className="w-16 h-1 rounded-full bg-gold mx-auto mt-4 mb-6" />
          <p className="section-subtitle max-w-xl mx-auto">
            Nous recherchons des financements pour produire la comédie, trouver des salles
            de répétitions et de spectacle.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-16">
          {/* Donation card */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <Card className="h-full border-gold/25 hover:shadow-card-hover transition-shadow duration-300">
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Heart size={18} className="text-gold" />
                  <Badge variant="gold">Cagnotte</Badge>
                </div>
                <CardTitle>Soutenir via Leetchi</CardTitle>
                <CardDescription>
                  Participe à notre cagnotte en ligne pour soutenir la production de
                  15 minutes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button variant="gold" size="lg" className="w-full" asChild>
                  <a
                    href="https://www.leetchi.com/fr/c/creation-du-projet-15-minutes-2844830"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                    Contribuer sur Leetchi
                  </a>
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* IBAN card */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <Card className="h-full border-teal/25 hover:shadow-card-hover transition-shadow duration-300">
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="default">Virement bancaire</Badge>
                </div>
                <CardTitle>Virement direct</CardTitle>
                <CardDescription>
                  Tu peux également faire un virement directement sur notre compte bancaire.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-background rounded-lg p-4 font-mono text-sm border border-black/6">
                  <p className="text-text-muted text-xs mb-1">IBAN</p>
                  <p className="text-teal font-medium text-base tracking-wider">{iban}</p>
                  <p className="text-text-muted text-xs mt-2">Mélange de Genres · 1226 Thônex</p>
                </div>
                <Button variant="outline" size="default" className="w-full" onClick={copyIban}>
                  {copied ? (
                    <>
                      <Check size={15} className="text-teal" />
                      Copié !
                    </>
                  ) : (
                    <>
                      <Copy size={15} />
                      Copier l'IBAN
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Volunteer section */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          custom={2}
        >
          <div className="text-center mb-8">
            <h3 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">
              Rejoindre l'équipe coulisses
            </h3>
            <p className="text-text-muted max-w-xl mx-auto">
              Nous sommes à la recherche de nouveaux membres ! Si tu maîtrises l'un de
              ces domaines ou que tu veux simplement donner un coup de main…
            </p>
          </div>

          <div className="flex flex-wrap gap-3 justify-center mb-8">
            {volunteerRoles.map((role, i) => (
              <motion.div
                key={role}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                viewport={{ once: true }}
                whileHover={{ scale: 1.05 }}
              >
                <Badge
                  variant={i % 2 === 0 ? 'default' : 'purple'}
                  className="text-sm px-4 py-2 cursor-default"
                >
                  {role}
                </Badge>
              </motion.div>
            ))}
          </div>

          <div className="flex justify-center">
            <Button variant="outline" size="lg" asChild>
              <a href="mailto:infomelangesdegenres@gmail.com">
                Nous contacter pour rejoindre l'équipe
              </a>
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
