import React from 'react';
import SEO from '../components/seo/SEO';
import { PAGE_META } from '../config/seo';
import SupportSection from '../components/sections/SupportSection';

export default function SoutenirPage() {
  return (
    <div className="pt-16 bg-surface flex-1">
      <SEO {...PAGE_META.soutenir} />
      <SupportSection />
    </div>
  );
}
