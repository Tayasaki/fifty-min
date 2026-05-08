import React from 'react';
import SEO from '../components/seo/SEO';
import { OrganizationLD } from '../components/seo/StructuredData';
import { PAGE_META } from '../config/seo';
import HeroSection from '../components/sections/HeroSection';
import TeasersSection from '../components/sections/TeasersSection';

export default function HomePage() {
  return (
    <>
      <SEO {...PAGE_META.home} />
      <OrganizationLD />
      <HeroSection />
      <TeasersSection />
    </>
  );
}
