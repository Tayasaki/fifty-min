import React from 'react';
import SEO from '../components/seo/SEO';
import { PAGE_META } from '../config/seo';
import ContactSection from '../components/sections/ContactSection';

export default function ContactPage() {
  return (
    <div className="pt-16 bg-background flex-1">
      <SEO {...PAGE_META.contact} />
      <ContactSection />
    </div>
  );
}
