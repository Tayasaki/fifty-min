import React from 'react';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD, TheaterEventLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import TicketingSection from '../components/sections/TicketingSection';

export default function BilletteriePage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.billetterie} />
      <BreadcrumbLD
        items={[
          { name: 'Accueil', url: SITE_URL },
          { name: 'Billetterie', url: `${SITE_URL}/billetterie` },
        ]}
      />
      <TheaterEventLD />
      <TicketingSection />
    </div>
  );
}
