import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PAGE_META, SITE_URL } from '../config/seo';
import TeasersSection, { buildTeasers } from '../components/sections/TeasersSection';
import { TICKETING_OFFER, theaterEvent } from '../components/seo/StructuredData';

const FLAG = 'REACT_APP_SHOW_TICKETING';
const saved = process.env[FLAG];

type FlagState = { label: string; value: string | undefined; enabled: boolean };

const OFF_STATES: FlagState[] = [
  { label: 'unset', value: undefined, enabled: false },
  { label: "'false'", value: 'false', enabled: false },
];
const ON_STATE: FlagState = { label: "'true'", value: 'true', enabled: true };
const ALL_STATES: FlagState[] = [...OFF_STATES, ON_STATE];

const FORBIDDEN_WHEN_OFF = ['Réservez', 'réservez', 'Réservations', 'PreOrder', 'Offer'];

const BILLETTERIE_ON =
  "Réservez gratuitement vos places pour « 15 minutes », la comédie musicale originale de Mélange de Genres, au Monique et à la Julienne. Places limitées.";
const BILLETTERIE_OFF =
  'La billetterie de « 15 minutes », la comédie musicale originale de Mélange de Genres, ouvrira prochainement.';
const AGENDA_ON =
  "Retrouvez toutes les dates et lieux des représentations de « 15 minutes » par l'association Mélange de Genres. Réservez dès maintenant.";
const AGENDA_OFF =
  "Retrouvez les rendez-vous de l'association Mélange de Genres autour de « 15 minutes ».";
const TEASER_ON = 'Février et mars 2027 — réservez votre place pour les représentations.';
const TEASER_OFF = 'La billetterie ouvrira prochainement.';

const THEATER_EVENT_BASE = {
  '@context': 'https://schema.org',
  '@type': 'TheaterEvent',
  name: '15 minutes',
  description:
    "La première comédie musicale originale de Mélange de Genres. Une exploration de la célébrité éphémère à l'ère des réseaux sociaux.",
  url: SITE_URL,
  performer: { '@type': 'Organization', name: 'Mélange de Genres', url: SITE_URL },
  organizer: { '@type': 'Organization', name: 'Mélange de Genres', url: SITE_URL },
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
  inLanguage: 'fr',
  eventStatus: 'https://schema.org/EventScheduled',
};
const THEATER_EVENT_ON = {
  ...THEATER_EVENT_BASE,
  offers: {
    '@type': 'Offer',
    url: `${SITE_URL}/billetterie`,
    availability: 'https://schema.org/PreOrder',
    priceCurrency: 'CHF',
  },
};

function setFlag(value: string | undefined) {
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
}

function billetterieTeaser(enabled: boolean) {
  const teaser = buildTeasers(enabled).find((t) => t.to === '/billetterie');
  if (!teaser) throw new Error('billetterie teaser missing');
  return teaser;
}

function expectNoForbidden(text: string) {
  FORBIDDEN_WHEN_OFF.forEach((word) => expect(text).not.toContain(word));
}

afterEach(() => {
  setFlag(saved);
});

describe.each(ALL_STATES)('flag $label: billetterie meta', ({ value, enabled }) => {
  test('description matches the flag state', () => {
    setFlag(value);
    expect(PAGE_META.billetterie.description).toBe(enabled ? BILLETTERIE_ON : BILLETTERIE_OFF);
  });
});

describe.each(ALL_STATES)('flag $label: agenda meta', ({ value, enabled }) => {
  test('description matches the flag state', () => {
    setFlag(value);
    expect(PAGE_META.agenda.description).toBe(enabled ? AGENDA_ON : AGENDA_OFF);
  });
});

describe.each(ALL_STATES)('flag $label: Billetterie teaser', ({ value, enabled }) => {
  test('description matches the flag state', () => {
    setFlag(value);
    expect(billetterieTeaser(enabled).description).toBe(enabled ? TEASER_ON : TEASER_OFF);
  });
});

describe.each(ALL_STATES)('flag $label: TheaterEvent JSON-LD', ({ value, enabled }) => {
  test('offers are present only when enabled', () => {
    setFlag(value);
    const event = theaterEvent(enabled ? TICKETING_OFFER : null);
    expect(event).toEqual(enabled ? THEATER_EVENT_ON : THEATER_EVENT_BASE);
    expect('offers' in event).toBe(enabled);
  });
});

describe.each(OFF_STATES)('flag $label: no reservation wording', ({ value }) => {
  beforeEach(() => setFlag(value));

  test('billetterie and agenda meta', () => {
    expectNoForbidden(PAGE_META.billetterie.description);
    expectNoForbidden(PAGE_META.agenda.description);
  });

  test('every teaser', () => {
    const text = buildTeasers(false)
      .map((t) => `${t.title} ${t.description}`)
      .join(' ');
    expectNoForbidden(text);
  });

  test('JSON-LD', () => {
    expectNoForbidden(JSON.stringify(theaterEvent(null)));
  });
});

describe('getter evaluation time', () => {
  test('spreading PAGE_META.billetterie evaluates the getter at spread time', () => {
    setFlag('false');
    const off = { ...PAGE_META.billetterie };
    setFlag('true');
    const on = { ...PAGE_META.billetterie };
    expect(off.description).toBe(BILLETTERIE_OFF);
    expect(on.description).toBe(BILLETTERIE_ON);
  });

  test('spreading PAGE_META.agenda evaluates the getter at spread time', () => {
    setFlag('true');
    const on = { ...PAGE_META.agenda };
    setFlag(undefined);
    const off = { ...PAGE_META.agenda };
    expect(on.description).toBe(AGENDA_ON);
    expect(off.description).toBe(AGENDA_OFF);
  });

  test('the other pages keep their static meta', () => {
    setFlag('true');
    const on = { ...PAGE_META.home };
    setFlag(undefined);
    expect({ ...PAGE_META.home }).toEqual(on);
  });
});

describe('TeasersSection render', () => {
  function renderTeasers() {
    return render(
      <MemoryRouter>
        <TeasersSection />
      </MemoryRouter>
    );
  }

  test('flag unset: shows the off Billetterie description', () => {
    setFlag(undefined);
    renderTeasers();
    expect(screen.getByText(TEASER_OFF)).toBeInTheDocument();
    expect(screen.queryByText(TEASER_ON)).not.toBeInTheDocument();
  });

  test("flag 'true': shows the on Billetterie description", () => {
    setFlag('true');
    renderTeasers();
    expect(screen.getByText(TEASER_ON)).toBeInTheDocument();
    expect(screen.queryByText(TEASER_OFF)).not.toBeInTheDocument();
  });

  test('the Billetterie link target is the same in both states', () => {
    expect(billetterieTeaser(false).to).toBe('/billetterie');
    expect(billetterieTeaser(true).to).toBe('/billetterie');
  });

  test('the flag does not change the other five teasers', () => {
    const others = (enabled: boolean) =>
      buildTeasers(enabled)
        .filter((t) => t.to !== '/billetterie')
        .map((t) => [t.to, t.title, t.description]);
    expect(others(false)).toEqual(others(true));
    expect(others(true)).toHaveLength(5);
  });
});
