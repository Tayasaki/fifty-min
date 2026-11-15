import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Ticket, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../assets/logo.jpg';
import { cn } from '../../lib/utils';

interface NavLink {
  label: string;
  to: string;
  /** Rendered as a call-to-action button instead of a plain link. */
  highlight?: boolean;
}

const navLinks: NavLink[] = [
  { label: 'Accueil', to: '/' },
  { label: 'Le spectacle', to: '/spectacle' },
  { label: "L'association", to: '/association' },
  { label: 'Ateliers', to: '/agenda' },
  { label: 'Soutenir', to: '/soutenir' },
  { label: 'Billetterie', to: '/billetterie', highlight: true },
  { label: 'Contact', to: '/contact' },
];

const ticketingLink = navLinks.find((link) => link.highlight);

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = (link: NavLink) => {
    const wasOpen = menuOpen;
    setMenuOpen(false);
    // Mobile menu close + navigate: small delay so the collapse animation isn't cut.
    setTimeout(() => navigate(link.to), wasOpen ? 250 : 0);
  };

  const isActive = (link: NavLink) => pathname === link.to;

  const linkStateClass = (link: NavLink) => {
    if (link.highlight) {
      return cn(
        'inline-flex items-center gap-1.5 rounded-full bg-teal-deep text-white font-medium shadow-teal-glow-sm hover:bg-teal-deep/90',
        isActive(link) && 'ring-2 ring-teal ring-offset-2'
      );
    }
    return cn('rounded-lg hover:bg-teal/6', isActive(link) ? 'text-teal font-medium' : 'text-text-muted hover:text-teal');
  };

  const linkContent = (link: NavLink) => (
    <>
      {link.highlight && <Ticket size={16} aria-hidden="true" />}
      {link.label}
    </>
  );

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' as const }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/90 backdrop-blur-md border-b border-black/8 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={() => handleNavClick({ label: 'Accueil', to: '/' })}
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
            <li key={link.to}>
              <button
                onClick={() => handleNavClick(link)}
                className={cn('px-3 py-2 text-sm transition-colors duration-200', link.highlight && 'ml-1 px-4', linkStateClass(link))}
              >
                {linkContent(link)}
              </button>
            </li>
          ))}
        </ul>

        {/* Mobile: ticketing shortcut stays visible next to the hamburger */}
        <div className="lg:hidden flex items-center gap-2">
          {ticketingLink && (
            <button
              onClick={() => handleNavClick(ticketingLink)}
              className={cn('px-3 py-1.5 text-sm transition-colors duration-200', linkStateClass(ticketingLink))}
            >
              {linkContent(ticketingLink)}
            </button>
          )}
          <button
            className="text-text-muted hover:text-teal transition-colors p-2"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
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
                <li key={link.to}>
                  <button
                    onClick={() => handleNavClick(link)}
                    className={cn('w-full text-left px-3 py-2.5 text-sm transition-colors duration-200', link.highlight && 'my-1 w-auto', linkStateClass(link))}
                  >
                    {linkContent(link)}
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
