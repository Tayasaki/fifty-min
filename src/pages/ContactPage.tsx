import React from 'react';
import SEO from '../components/seo/SEO';
import { BreadcrumbLD } from '../components/seo/StructuredData';
import { PAGE_META, SITE_URL } from '../config/seo';
import ContactSection from '../components/sections/ContactSection';

export default function ContactPage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.contact} />
      <BreadcrumbLD
        items={[
          { name: 'Accueil', url: SITE_URL },
          { name: 'Contact', url: `${SITE_URL}/contact` },
        ]}
      />
      <ContactSection />
    </div>
  );
}
