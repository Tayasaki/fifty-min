import React from 'react';
import { useSearchParams } from 'react-router-dom';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD, TheaterEventLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import TicketingSection from '../components/sections/TicketingSection';
import ReservationAction from '../components/sections/ReservationAction';

export default function BilletteriePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const confirmId = searchParams.get('confirmer');
  const cancelId = searchParams.get('annuler');

  let content = <TicketingSection />;
  if (token && confirmId) content = <ReservationAction action="confirm" id={confirmId} token={token} />;
  else if (token && cancelId) content = <ReservationAction action="cancel" id={cancelId} token={token} />;

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
      {content}
    </div>
  );
}
