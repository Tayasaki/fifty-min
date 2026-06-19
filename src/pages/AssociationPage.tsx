import React from 'react';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import AssociationSection from '../components/sections/AssociationSection';

export default function AssociationPage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.association} />
      <BreadcrumbLD
        items={[
          { name: 'Accueil', url: SITE_URL },
          { name: "L'association", url: `${SITE_URL}/association` },
        ]}
      />
      <AssociationSection />
    </div>
  );
}
