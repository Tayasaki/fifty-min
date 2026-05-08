import React from 'react';
import SEO from '../components/seo/SEO';
import { PAGE_META } from '../config/seo';
import EventsSection from '../components/sections/EventsSection';

export default function AgendaPage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.agenda} />
      <EventsSection />
    </div>
  );
}
