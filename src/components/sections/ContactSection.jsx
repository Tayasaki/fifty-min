import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Mail, Phone, MapPin } from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.12, ease: 'easeOut' },
  }),
};

const contactItems = [
  {
    icon: Mail,
    label: 'Email',
    value: 'infomelangesdegenres@gmail.com',
    href: 'mailto:infomelangesdegenres@gmail.com',
    color: 'text-teal',
  },
  {
    icon: Phone,
    label: 'Téléphone',
    value: '+41 79 327 66 63',
    href: 'tel:+41793276663',
    color: 'text-purple',
  },
  {
    icon: MapPin,
    label: 'Adresse',
    value: '1226 Thônex, Suisse',
    href: null,
    color: 'text-gold',
  },
];

export default function ContactSection() {
  return (
    <section id="contact" className="bg-background py-24">
      <div className="max-w-6xl mx-auto px-6">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="text-center mb-16"
        >
          <p className="text-teal text-sm font-medium tracking-widest uppercase mb-3">
            Restons en contact
          </p>
          <h2 className="section-title">Contact</h2>
          <div className="w-16 h-1 rounded-full bg-teal mx-auto mt-4 mb-6" />
          <p className="section-subtitle max-w-md mx-auto">
            Une question sur le spectacle ? Envie de rejoindre l'aventure ? Écrivez-nous !
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start max-w-4xl mx-auto">
          {/* Contact card */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <Card className="border-teal/20 hover:shadow-card-hover transition-shadow duration-300">
              <CardHeader>
                <div className="flex items-center gap-4 mb-2">
                  <div
                    className="h-12 w-12 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: '#7BB7AA1A', border: '1px solid #7BB7AA40' }}
                  >
                    <span className="font-display font-bold text-teal text-lg">N</span>
                  </div>
                  <div>
                    <CardTitle>Nora « Pâris » Spycher</CardTitle>
                    <CardDescription className="text-teal/80">
                      Présidente & Metteuse en scène
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {contactItems.map((item) => {
                  const Icon = item.icon;
                  const content = (
                    <div className="flex items-center gap-3 group">
                      <Icon size={16} className={`${item.color} shrink-0`} />
                      <div>
                        <p className="text-xs text-text-muted mb-0.5">{item.label}</p>
                        <p
                          className={`text-sm text-text-primary ${
                            item.href ? 'group-hover:text-teal transition-colors' : ''
                          }`}
                        >
                          {item.value}
                        </p>
                      </div>
                    </div>
                  );

                  return item.href ? (
                    <a key={item.label} href={item.href} className="block">
                      {content}
                    </a>
                  ) : (
                    <div key={item.label}>{content}</div>
                  );
                })}
              </CardContent>
            </Card>
          </motion.div>

          {/* CTA */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
            className="flex flex-col gap-4"
          >
            <div className="border border-black/8 bg-white rounded-2xl p-8 text-center shadow-card">
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="text-5xl mb-4"
              >
                ✉️
              </motion.div>
              <h3 className="font-display text-xl font-bold text-text-primary mb-3">
                Envoyez-nous un message
              </h3>
              <p className="text-text-muted text-sm mb-6 leading-relaxed">
                Pour toute question, partenariat, collaboration ou bénévolat, nous serons
                ravis de vous répondre.
              </p>
              <Button size="lg" className="w-full" asChild>
                <a href="mailto:infomelangesdegenres@gmail.com">
                  <Mail size={16} />
                  Écrire un email
                </a>
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
