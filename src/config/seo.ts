export const SITE_NAME = 'Mélange de Genres';
export const SITE_URL = 'https://melangedegenres.vercel.app';
export const DEFAULT_OG_IMAGE = '/og-image.jpg';
export const DEFAULT_TWITTER_CARD = 'summary_large_image';

export interface PageMeta {
  title: string;
  description: string;
  path: string;
}

export const PAGE_META: Record<string, PageMeta> = {
  home: {
    title: '15 minutes',
    description:
      "La première comédie musicale originale de Mélange de Genres. Une exploration de la célébrité éphémère à l'ère des réseaux sociaux, portée par une vingtaine de comédien·ne·s.",
    path: '/',
  },
  spectacle: {
    title: 'Le spectacle',
    description:
      "« 15 minutes » : une comédie musicale originale sur la célébrité éphémère. Découvrez l'histoire, les personnages et l'équipe créative de Mélange de Genres.",
    path: '/spectacle',
  },
  association: {
    title: 'Notre association',
    description:
      "Mélange de Genres est une association culturelle dédiée à la création musicale et théâtrale. Découvrez notre histoire, notre équipe et nos valeurs.",
    path: '/association',
  },
  agenda: {
    title: 'Agenda',
    description:
      "Retrouvez toutes les dates et lieux des représentations de « 15 minutes » par l'association Mélange de Genres. Réservez dès maintenant.",
    path: '/agenda',
  },
  billetterie: {
    title: 'Billetterie',
    description:
      "Achetez vos billets pour « 15 minutes », la comédie musicale originale de Mélange de Genres. Places limitées — réservez en ligne.",
    path: '/billetterie',
  },
  soutenir: {
    title: 'Nous soutenir',
    description:
      "Soutenez la création de « 15 minutes » et aidez Mélange de Genres à financer son premier spectacle musical original. Chaque contribution compte.",
    path: '/soutenir',
  },
  contact: {
    title: 'Contact',
    description:
      "Contactez l'association Mélange de Genres pour toute question sur le spectacle « 15 minutes », les partenariats ou la presse.",
    path: '/contact',
  },
};
