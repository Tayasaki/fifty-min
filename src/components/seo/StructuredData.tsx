import React from 'react';
import { Helmet } from 'react-helmet-async';
import { SITE_URL } from '../../config/seo';

const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Mélange de Genres',
  url: SITE_URL,
  description:
    "Association culturelle dédiée à la création musicale et théâtrale, auteure de la comédie musicale originale « 15 minutes ».",
};

const ORGANIZATION_REF = {
  '@type': 'Organization',
  name: 'Mélange de Genres',
  url: SITE_URL,
} as const;

const THEATER_EVENT = {
  '@context': 'https://schema.org',
  '@type': 'TheaterEvent',
  name: '15 minutes',
  description:
    "La première comédie musicale originale de Mélange de Genres. Une exploration de la célébrité éphémère à l'ère des réseaux sociaux.",
  url: SITE_URL,
  performer: ORGANIZATION_REF,
  organizer: ORGANIZATION_REF,
  startDate: '2027-02-01',
  endDate: '2027-04-30',
  location: {
    '@type': 'Place',
    name: 'Suisse romande',
    address: {
      '@type': 'PostalAddress',
      addressRegion: 'Suisse romande',
      addressCountry: 'CH',
    },
  },
  offers: {
    '@type': 'Offer',
    url: `${SITE_URL}/billetterie`,
    availability: 'https://schema.org/PreOrder',
    priceCurrency: 'CHF',
  },
  inLanguage: 'fr',
  eventStatus: 'https://schema.org/EventScheduled',
};

export function OrganizationLD() {
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(ORGANIZATION)}</script>
    </Helmet>
  );
}

export function TheaterEventLD() {
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(THEATER_EVENT)}</script>
    </Helmet>
  );
}
