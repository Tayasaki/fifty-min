import React from 'react';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD, EventLD } from '../components/seo/StructuredData';
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
      <EventLD
        name="Uni Art Fait Son Live"
        description="Blind test plein de surprises organisé par Uni Art et Mélange de Genres. Venez participer et tentez de remporter des prix !"
        startDate="2026-05-01T19:00:00"
        locationName="Floky Bar"
        locationDetail="Sous-sol"
        url={`${SITE_URL}/agenda`}
      />
      <EventsSection />
    </div>
  );
}
