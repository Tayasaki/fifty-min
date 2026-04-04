import React from 'react';
import { Mail } from 'lucide-react';
import logo from '../../assets/logo.jpg';

export default function Footer() {
  return (
    <footer className="border-t border-black/8 bg-surface-2 py-12">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-white flex items-center justify-center shadow-sm overflow-hidden">
            <img
              src={logo}
              alt="Mélange de Genres"
              className="h-full w-full object-contain"
              style={{ mixBlendMode: 'multiply' }}
            />
          </div>
          <div>
            <p className="font-display font-bold text-teal text-sm">Mélange de Genres</p>
            <p className="text-text-muted text-xs">1226 Thônex, Suisse</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-text-muted text-sm">
          <Mail size={14} className="text-teal" />
          <a
            href="mailto:infomelangesdegenres@gmail.com"
            className="hover:text-teal transition-colors"
          >
            infomelangesdegenres@gmail.com
          </a>
        </div>

        <p className="text-text-muted text-xs text-center md:text-right">
          © 2026 Mélange de Genres — Tous droits réservés
          <br />
          <span className="text-teal/70">15 minutes · Saison 2026–2027</span>
        </p>
      </div>
    </footer>
  );
}
