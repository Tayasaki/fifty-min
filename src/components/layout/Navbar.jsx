import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import logo from '../../assets/logo.jpg';

const navLinks = [
  { label: 'Accueil', href: '#accueil' },
  { label: 'Le spectacle', href: '#spectacle' },
  { label: "L'association", href: '#association' },
  { label: 'Ateliers', href: '#ateliers' },
  { label: 'Soutenir', href: '#soutenir' },
  { label: 'Billetterie', href: '#billetterie' },
  { label: 'Contact', href: '#contact' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = (href) => {
    setMenuOpen(false);
    // Wait for the mobile menu close animation (250ms) before scrolling,
    // otherwise the layout shift from the collapsing menu disrupts the scroll target position.
    setTimeout(() => {
      const el = document.querySelector(href);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 300);
  };

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/90 backdrop-blur-md border-b border-black/8 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={() => handleNavClick('#accueil')}
          className="flex items-center gap-3 group"
        >
          <div className="h-9 w-9 rounded-full bg-white flex items-center justify-center shadow-sm overflow-hidden">
            <img
              src={logo}
              alt="Mélange de Genres"
              className="h-full w-full object-contain"
              style={{ mixBlendMode: 'multiply' }}
            />
          </div>
          <span className="font-display font-bold text-teal text-sm tracking-wide hidden sm:block">
            Mélange de Genres
          </span>
        </button>

        {/* Desktop links */}
        <ul className="hidden lg:flex items-center gap-1">
          {navLinks.map((link) => (
            <li key={link.href}>
              <button
                onClick={() => handleNavClick(link.href)}
                className="px-3 py-2 text-sm text-text-muted hover:text-teal transition-colors duration-200 rounded-lg hover:bg-teal/6"
              >
                {link.label}
              </button>
            </li>
          ))}
        </ul>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden text-text-muted hover:text-teal transition-colors p-2"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="lg:hidden bg-white/95 backdrop-blur-md border-b border-black/8 overflow-hidden"
          >
            <ul className="px-6 py-4 flex flex-col gap-1">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <button
                    onClick={() => handleNavClick(link.href)}
                    className="w-full text-left px-3 py-2.5 text-sm text-text-muted hover:text-teal transition-colors duration-200 rounded-lg hover:bg-teal/6"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
