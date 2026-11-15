import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminPage from '../pages/AdminPage';
import { SHOWS } from '../config/shows';
import { type FetchMock, installFetch, uninstallFetch } from './helpers/fetch';

jest.mock('../components/seo/SEO', () => ({ __esModule: true, default: () => null }));

const ADMIN_TOKEN = 'a-very-secret-admin-token-of-32-chars!!';

let fetchMock: FetchMock;
// CRA enables resetMocks: implementations are (re)created in beforeEach.
let createObjectURL: jest.Mock;
let revokeObjectURL: jest.Mock;

/** jsdom has no Response: only what the page reads. */
function csvResponse(status: number, disposition?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-disposition' ? disposition ?? null : null) },
    blob: async () => ({ size: 1 }) as unknown as Blob,
  } as unknown as Response;
}

beforeEach(() => {
  createObjectURL = jest.fn(() => 'blob:fake');
  revokeObjectURL = jest.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = installFetch(() => csvResponse(200, 'attachment; filename="reservations-2027-02-20-monique.csv"'));
});

afterEach(() => {
  uninstallFetch();
  jest.restoreAllMocks();
});

function submit(token: string, showId = '') {
  render(<AdminPage />);
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: token } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: showId } });
  fireEvent.click(screen.getByRole('button', { name: /Télécharger le CSV/ }));
}

test('the token field is a password field without autocomplete', () => {
  render(<AdminPage />);
  const input = screen.getByLabelText('Mot de passe');
  expect(input).toHaveAttribute('type', 'password');
  expect(input).toHaveAttribute('autocomplete', 'off');
  expect(screen.getByRole('option', { name: 'Toutes les dates' })).toHaveValue('');
  for (const show of SHOWS) expect(screen.getByRole('option', { name: show.label })).toHaveValue(show.id);
});

test('sends the token only in the Authorization header, never in the URL', async () => {
  submit(ADMIN_TOKEN);
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake'));

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/reservations');
  expect(url).not.toContain(ADMIN_TOKEN);
  expect(init?.headers).toEqual({ Authorization: 'Bearer ' + ADMIN_TOKEN });
  expect(init?.cache).toBe('no-store');
});

test('adds ?show= only when a date is chosen, and names the file from Content-Disposition', async () => {
  let downloaded = '';
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloaded = this.download;
  });
  submit(ADMIN_TOKEN, '2027-02-20-monique');
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalled());

  expect(fetchMock.mock.calls[0][0]).toBe('/api/reservations?show=2027-02-20-monique');
  expect(downloaded).toBe('reservations-2027-02-20-monique.csv');
});

test('falls back to reservations.csv without Content-Disposition', async () => {
  fetchMock = installFetch(() => csvResponse(200));
  let downloaded = '';
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloaded = this.download;
  });
  submit(ADMIN_TOKEN);
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalled());
  expect(downloaded).toBe('reservations.csv');
});

test.each([
  [401, 'Mot de passe incorrect'],
  [403, 'Mot de passe incorrect'],
  [503, 'Export non configuré sur le serveur'],
  [500, 'Erreur, réessayez'],
])('status %i shows « %s »', async (status, message) => {
  fetchMock = installFetch(() => csvResponse(status));
  submit(ADMIN_TOKEN);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(createObjectURL).not.toHaveBeenCalled();
});

test('a network failure shows « Erreur, réessayez »', async () => {
  fetchMock = installFetch(() => Promise.reject(new TypeError('Failed to fetch')));
  submit(ADMIN_TOKEN);
  expect(await screen.findByRole('alert')).toHaveTextContent('Erreur, réessayez');
});

test('writes nothing to localStorage or sessionStorage', async () => {
  const setItem = jest.spyOn(Storage.prototype, 'setItem');
  submit(ADMIN_TOKEN);
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalled());

  expect(setItem).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(document.cookie).not.toContain(ADMIN_TOKEN);
});
