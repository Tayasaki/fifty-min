import React from 'react';
import SEO from '../components/seo/SEO';
import { PAGE_META } from '../config/seo';
import AssociationSection from '../components/sections/AssociationSection';

export default function AssociationPage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.association} />
      <AssociationSection />
    </div>
  );
}
