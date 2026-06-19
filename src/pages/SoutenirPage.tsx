import React from 'react';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import SupportSection from '../components/sections/SupportSection';

export default function SoutenirPage() {
  return (
    <div className="pt-16 bg-surface flex-1">
      <SEO {...PAGE_META.soutenir} />
      <BreadcrumbLD
        items={[
          { name: 'Accueil', url: SITE_URL },
          { name: 'Nous soutenir', url: `${SITE_URL}/soutenir` },
        ]}
      />
      <SupportSection />
    </div>
  );
}
