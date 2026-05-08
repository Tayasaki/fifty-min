import React from 'react';
import SEO from '../components/seo/SEO';
import { TheaterEventLD } from '../components/seo/StructuredData';
import { PAGE_META } from '../config/seo';
import ShowSection from '../components/sections/ShowSection';

export default function SpectaclePage() {
  return (
    <div className="pt-16 bg-surface flex-1">
      <SEO {...PAGE_META.spectacle} />
      <TheaterEventLD />
      <ShowSection />
    </div>
  );
}
