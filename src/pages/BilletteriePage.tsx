import React from 'react';
import { useSearchParams } from 'react-router-dom';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD, TheaterEventLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import TicketingSection from '../components/sections/TicketingSection';
import CancelReservation from '../components/sections/CancelReservation';

export default function BilletteriePage() {
  const [searchParams] = useSearchParams();
  const cancelId = searchParams.get('annuler');
  const cancelToken = searchParams.get('token');

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
      {cancelId && cancelToken ? (
        <CancelReservation id={cancelId} token={cancelToken} />
      ) : (
        <TicketingSection />
      )}
    </div>
  );
}
