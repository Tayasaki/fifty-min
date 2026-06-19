import React from 'react';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD, TheaterEventLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import ShowSection from '../components/sections/ShowSection';

export default function SpectaclePage() {
  return (
    <div className="pt-16 bg-surface flex-1">
      <SEO {...PAGE_META.spectacle} />
      <BreadcrumbLD
        items={[
          { name: 'Accueil', url: SITE_URL },
          { name: 'Le spectacle', url: `${SITE_URL}/spectacle` },
        ]}
      />
      <TheaterEventLD />
      <ShowSection />
    </div>
  );
}
