import React from 'react';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import EventsSection from '../components/sections/EventsSection';

export default function AgendaPage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.agenda} />
      <BreadcrumbLD
        items={[
          { name: 'Accueil', url: SITE_URL },
          { name: 'Agenda', url: `${SITE_URL}/agenda` },
        ]}
      />
      <EventsSection />
    </div>
  );
}
