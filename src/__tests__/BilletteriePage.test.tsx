import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BilletteriePage from '../pages/BilletteriePage';
import { INVALID_LINK_COPY } from '../config/billetterieCopy';
import { type FetchMock, fakeResponse, installFetch, uninstallFetch } from './helpers/fetch';

// The page's own job is routing between the booking form and the link actions;
// the neighbours are replaced so this suite does not depend on their internals.
jest.mock('../components/sections/TicketingSection', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('div', null, 'Booking form') };
});
jest.mock('../components/seo/SEO', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/seo/StructuredData', () => ({
  BreadcrumbLD: () => null,
  TheaterEventLD: () => null,
}));
jest.mock('../config/seo', () => ({
  PAGE_META: { billetterie: {} },
  SITE_URL: 'https://example.test',
}));

const ID = 'A1B2C3D4';
const TOKEN = 'eyJzaWduZWQiOiJ0b2tlbiJ9.c2lnbmF0dXJl';

let fetchMock: FetchMock;

const CONFIRM_PREVIEW = {
  id: ID,
  showId: '2027-02-20-monique',
  name: 'Camille',
  quantity: 2,
  status: 'claimable',
  availability: 10,
  open: true,
};
const CANCEL_PREVIEW = { id: ID, showId: '2027-02-20-monique', name: 'Camille', quantity: 2, status: 'confirmed', closed: false };

function serve(preview: unknown) {
  fetchMock = installFetch((_url, init) => fakeResponse(init?.method === 'POST' ? 500 : 200, preview));
}

beforeEach(() => serve(CONFIRM_PREVIEW));

afterEach(() => {
  uninstallFetch();
});

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/billetterie${search}`]}>
      <BilletteriePage />
    </MemoryRouter>
  );
}

describe('BilletteriePage routing', () => {
  test('a confirm link without a token is the neutral invalid state and sends no request', async () => {
    renderAt(`?confirmer=${ID}`);
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(screen.queryByText('Booking form')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a confirm link with a token renders the confirm action', async () => {
    renderAt(`?confirmer=${ID}&token=${TOKEN}`);
    expect(await screen.findByRole('button', { name: 'Confirmer ma réservation' })).toBeInTheDocument();
    expect(screen.queryByText('Booking form')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(`id=${ID}`);
  });

  test('a cancel link with a token renders the cancel action', async () => {
    serve(CANCEL_PREVIEW);
    renderAt(`?annuler=${ID}&token=${TOKEN}`);
    expect(await screen.findByRole('button', { name: "Confirmer l'annulation" })).toBeInTheDocument();
    expect(screen.queryByText('Booking form')).not.toBeInTheDocument();
  });

  test('a cancel link without a token is the neutral invalid state and sends no request', async () => {
    renderAt(`?annuler=${ID}`);
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an empty id value still routes to the action and is invalid', async () => {
    renderAt(`?confirmer=&token=${TOKEN}`);
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('without confirmer or annuler the booking form is shown and nothing is fetched', () => {
    renderAt('');
    expect(screen.getByText('Booking form')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a token alone does not hide the booking form', () => {
    renderAt(`?token=${TOKEN}`);
    expect(screen.getByText('Booking form')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('the token is never rendered on the page', async () => {
    const { container } = renderAt(`?confirmer=${ID}&token=${TOKEN}`);
    await screen.findByRole('button', { name: 'Confirmer ma réservation' });
    expect(container.innerHTML).not.toContain(TOKEN);
  });
});
