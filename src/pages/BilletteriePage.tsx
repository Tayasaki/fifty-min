import React from 'react';
import SEO from '../components/seo/SEO';
import { PAGE_META } from '../config/seo';
import TicketingSection from '../components/sections/TicketingSection';

export default function BilletteriePage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.billetterie} />
      <TicketingSection />
    </div>
  );
}
