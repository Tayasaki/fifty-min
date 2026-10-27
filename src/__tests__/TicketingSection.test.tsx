/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the honeypot, the widget scripts and the source scan have no accessible role */
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketingSection from '../components/sections/TicketingSection';
import { CONTACT_EMAIL, CLOSED_COPY, PRIVACY_NOTICE, SUCCESS_TITLE, UNAVAILABLE_COPY } from '../config/billetterieCopy';
import { MAX_TICKETS_PER_EMAIL, RECORD_RETENTION_DAYS, SHOWS } from '../config/shows';
import { CLIENT_ERROR, GENERIC_ERROR, NETWORK_ERROR, SERVER_ERROR } from '../lib/billetterieApi';
import { formatDateTime } from '../lib/formatDateTime';
import { type FakeTurnstile, installFakeTurnstile, uninstallFakeTurnstile } from './helpers/turnstile';
import { type FetchMock, fakeResponse, installFetch, uninstallFetch } from './helpers/fetch';

const SITE_KEY = '1x00000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const SHOW = SHOWS[0];
const OTHER_SHOW = SHOWS[2];
const NAME = 'Jean Dupont';
const EMAIL = 'jean@example.com';

type Handler = (init: RequestInit | undefined) => Promise<Response> | Response;

interface Server {
  availability: Record<string, number>;
  open: boolean | undefined;
  availabilityResponse: (() => Promise<Response> | Response) | null;
  reserve: Handler;
}

let server: Server;
let fetchMock: FetchMock;
let turnstile: FakeTurnstile;

function fullAvailability(value = 100): Record<string, number> {
  return Object.fromEntries(SHOWS.map((s) => [s.id, value]));
}

function futureIso(): string {
  return new Date(Date.now() + 48 * 3600 * 1000).toISOString();
}

function okReserve(): Response {
  return fakeResponse(200, { ok: true, linkExpiresAt: futureIso() });
}

function setEnv(flag: string | undefined, key: string | undefined): void {
  if (flag === undefined) delete process.env.REACT_APP_SHOW_TICKETING;
  else process.env.REACT_APP_SHOW_TICKETING = flag;
  if (key === undefined) delete process.env.REACT_APP_TURNSTILE_SITE_KEY;
  else process.env.REACT_APP_TURNSTILE_SITE_KEY = key;
}

beforeEach(() => {
  setEnv('true', SITE_KEY);
  server = { availability: fullAvailability(), open: true, availabilityResponse: null, reserve: okReserve };
  fetchMock = installFetch((url, init) => {
    if (url === '/api/availability') {
      if (server.availabilityResponse) return server.availabilityResponse();
      return fakeResponse(200, server.open === undefined ? { availability: server.availability } : { availability: server.availability, open: server.open });
    }
    if (url === '/api/reserve') return server.reserve(init);
    throw new Error(`unexpected request: ${url}`);
  });
  turnstile = installFakeTurnstile();
});

afterEach(() => {
  document.querySelectorAll('script[src*="challenges.cloudflare.com"]').forEach((script) => {
    script.dispatchEvent(new Event('error'));
    script.remove();
  });
  uninstallFakeTurnstile();
  uninstallFetch();
  setEnv(undefined, undefined);
  jest.restoreAllMocks();
});

const gets = () => fetchMock.mock.calls.filter(([url]) => url === '/api/availability').length;
const posts = () => fetchMock.mock.calls.filter(([url]) => url === '/api/reserve');

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderSection() {
  const view = render(<TicketingSection />);
  await waitFor(() => expect(gets()).toBe(1));
  await settle();
  return view;
}

const showButton = (label: string) => screen.getByRole('button', { name: (name) => name.includes(label) });
const nameInput = () => screen.getByLabelText(/Nom et prénom/);
const emailInput = () => screen.getByLabelText(/^Email/);
const confirmInput = () => screen.getByLabelText(/^Confirmez votre email/);
const quantitySelect = () => screen.getByLabelText(/Nombre de places/) as HTMLSelectElement;
const submitButton = () => screen.getByRole('button', { name: /Réserver gratuitement|Réservation en cours/ });
const honeypot = () => document.querySelector('input[name="website"]') as HTMLInputElement;
const quantityOptions = () => within(quantitySelect()).getAllByRole('option').map((o) => Number((o as HTMLOptionElement).value));

async function openForm(show = SHOW) {
  userEvent.click(showButton(show.label));
  await waitFor(() => expect(turnstile.live()).toHaveLength(1));
}

function giveToken(token = TOKEN) {
  act(() => turnstile.live()[0].options.callback?.(token));
}

function fillForm(email = EMAIL, confirm = email) {
  userEvent.type(nameInput(), NAME);
  userEvent.type(emailInput(), email);
  userEvent.type(confirmInput(), confirm);
}

async function readyToSubmit(show = SHOW) {
  await renderSection();
  await openForm(show);
  fillForm();
  giveToken();
}

async function submit() {
  userEvent.click(submitButton());
  await waitFor(() => expect(posts()).toHaveLength(1));
}

function sentBody(): Record<string, unknown> {
  const init = posts()[0][1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('flag off', () => {
  test('shows the coming-soon panel', () => {
    setEnv(undefined, SITE_KEY);
    render(<TicketingSection />);
    expect(screen.getByRole('heading', { name: 'Bientôt disponible' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: (n) => n.includes(SHOW.label) })).not.toBeInTheDocument();
  });

  test('makes no fetch call at all', async () => {
    setEnv('false', SITE_KEY);
    render(<TicketingSection />);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(turnstile.render).not.toHaveBeenCalled();
  });

  test.each(['TRUE', ' true', '1'])('only the exact value "true" enables ticketing (%j)', async (value) => {
    setEnv(value, SITE_KEY);
    render(<TicketingSection />);
    await settle();
    expect(screen.getByRole('heading', { name: 'Bientôt disponible' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not advertise reservations in the header', () => {
    setEnv(undefined, SITE_KEY);
    render(<TicketingSection />);
    expect(screen.queryByText(/réservation est obligatoire/)).not.toBeInTheDocument();
  });
});

describe('flag on: availability', () => {
  test('fetches availability exactly once on mount and never again without an action', async () => {
    await renderSection();
    await settle();
    expect(gets()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('labels each show from the availability', async () => {
    server.availability = { ...fullAvailability(), [SHOWS[0].id]: 0, [SHOWS[1].id]: 3, [SHOWS[2].id]: 1 };
    await renderSection();
    expect(showButton(SHOWS[0].label)).toHaveTextContent('Complet');
    expect(showButton(SHOWS[1].label)).toHaveTextContent('Plus que 3 places');
    expect(showButton(SHOWS[2].label)).toHaveTextContent('Plus que 1 place');
    expect(showButton(SHOWS[2].label)).not.toHaveTextContent('Plus que 1 places');
    expect(showButton(SHOWS[3].label)).toHaveTextContent('Places disponibles');
  });

  test('a sold-out show cannot be selected', async () => {
    server.availability = { ...fullAvailability(), [SHOW.id]: 0 };
    await renderSection();
    expect(showButton(SHOW.label)).toBeDisabled();
    userEvent.click(showButton(SHOW.label));
    expect(screen.queryByRole('button', { name: /Réserver gratuitement/ })).not.toBeInTheDocument();
  });

  test('open === false replaces the panel with the closed notice and disables every show', async () => {
    server.open = false;
    await renderSection();
    expect(screen.getByText(CLOSED_COPY.text)).toBeInTheDocument();
    SHOWS.forEach((s) => expect(showButton(s.label)).toBeDisabled());
    expect(screen.queryByText('Sélectionnez une date pour réserver vos places.')).not.toBeInTheDocument();
    expect(turnstile.render).not.toHaveBeenCalled();
  });

  test('open === true keeps the hint and the form available', async () => {
    await renderSection();
    expect(screen.getByText('Sélectionnez une date pour réserver vos places.')).toBeInTheDocument();
    await openForm();
    expect(submitButton()).toBeInTheDocument();
  });

  test('a missing open flag keeps the form', async () => {
    server.open = undefined;
    await renderSection();
    await openForm();
    expect(screen.queryByText(CLOSED_COPY.text)).not.toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
  });

  test('a failed availability fetch keeps the form and the shows selectable', async () => {
    server.availabilityResponse = () => Promise.reject(new TypeError('offline'));
    await renderSection();
    expect(screen.queryByText(CLOSED_COPY.text)).not.toBeInTheDocument();
    await openForm();
    expect(submitButton()).toBeInTheDocument();
    expect(showButton(SHOW.label)).not.toHaveTextContent('Complet');
  });

  test('a malformed availability body is ignored', async () => {
    server.availabilityResponse = () => fakeResponse(200, { nope: true });
    await renderSection();
    await openForm();
    expect(submitButton()).toBeInTheDocument();
  });
});

describe('no site key', () => {
  test('shows the unavailable panel with the contact mailto, no widget, no submit, no POST', async () => {
    setEnv('true', '   ');
    await renderSection();
    userEvent.click(showButton(SHOW.label));
    expect(await screen.findByText(UNAVAILABLE_COPY.title)).toBeInTheDocument();
    expect(screen.getByText(UNAVAILABLE_COPY.body)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /écrire/i })).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
    expect(turnstile.render).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Réserver gratuitement/ })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  test('an unset site key behaves the same', async () => {
    setEnv('true', undefined);
    await renderSection();
    userEvent.click(showButton(SHOW.label));
    expect(await screen.findByText(UNAVAILABLE_COPY.title)).toBeInTheDocument();
    expect(turnstile.render).not.toHaveBeenCalled();
  });
});

describe('widget unavailable', () => {
  test('a widget error shows the unavailable panel and a retry mounts a fresh widget, keeping the typed values', async () => {
    await renderSection();
    await openForm();
    fillForm();
    act(() => turnstile.live()[0].options['error-callback']?.('110200'));
    expect(await screen.findByText(UNAVAILABLE_COPY.title)).toBeInTheDocument();
    expect(turnstile.live()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Réserver gratuitement/ })).not.toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(turnstile.live()).toHaveLength(1));
    expect(turnstile.widgets).toHaveLength(2);
    expect(nameInput()).toHaveValue(NAME);
    expect(emailInput()).toHaveValue(EMAIL);
    expect(submitButton()).toBeDisabled();
  });

  test('a blocked script shows the unavailable panel', async () => {
    uninstallFakeTurnstile();
    await renderSection();
    userEvent.click(showButton(SHOW.label));
    await waitFor(() => expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).not.toBeNull());
    act(() => {
      document.querySelector('script[src*="challenges.cloudflare.com"]')?.dispatchEvent(new Event('error'));
    });
    expect(await screen.findByText(UNAVAILABLE_COPY.title)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
});

describe('form', () => {
  test('renders the venue, the show and the existing fields', async () => {
    await renderSection();
    await openForm();
    expect(screen.getByRole('heading', { name: SHOW.label })).toBeInTheDocument();
    expect(nameInput()).toBeRequired();
    expect(emailInput()).toBeRequired();
    expect(confirmInput()).toBeRequired();
    expect(quantitySelect()).toHaveValue('1');
  });

  test('the honeypot is hidden from people and from tab order', async () => {
    await renderSection();
    await openForm();
    const field = honeypot();
    expect(field).not.toBeNull();
    expect(field.tabIndex).toBe(-1);
    expect(field).toHaveAttribute('aria-hidden', 'true');
    expect(field).toHaveClass('hidden');
  });

  test.each([
    [100, [1, 2, 3, 4]],
    [5, [1, 2, 3, 4]],
    [4, [1, 2, 3, 4]],
    [2, [1, 2]],
    [1, [1]],
  ])('with %i seats left the quantity options are %j', async (left, options) => {
    server.availability = { ...fullAvailability(), [SHOW.id]: left };
    await renderSection();
    await openForm();
    expect(quantityOptions()).toEqual(options);
    expect(Math.max(...quantityOptions())).toBeLessThanOrEqual(MAX_TICKETS_PER_EMAIL);
  });

  test('suggests a corrected address and applies it on click', async () => {
    await renderSection();
    await openForm();
    userEvent.type(emailInput(), 'jean@gmial.com');
    fireEvent.blur(emailInput());
    userEvent.click(await screen.findByRole('button', { name: 'jean@gmail.com' }));
    expect(emailInput()).toHaveValue('jean@gmail.com');
  });

  test('the privacy notice sits inside the form, above the submit button, with the facts', async () => {
    await renderSection();
    await openForm();
    const form = submitButton().closest('form') as HTMLFormElement;
    const notice = within(form).getByText((_, el) => el?.textContent?.includes(PRIVACY_NOTICE.heading) === true && el.tagName === 'P');
    expect(notice.compareDocumentPosition(submitButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice).toHaveTextContent(/nom/);
    expect(notice).toHaveTextContent(/adresse email/);
    expect(notice).toHaveTextContent(/nombre de places/);
    expect(notice).toHaveTextContent(`${RECORD_RETENTION_DAYS} jours`);
    expect(notice).toHaveTextContent(CONTACT_EMAIL);
  });

  test('the submit button is disabled until a token exists', async () => {
    await renderSection();
    await openForm();
    fillForm();
    expect(submitButton()).toBeDisabled();
    giveToken();
    expect(submitButton()).toBeEnabled();
  });

  test('an expired token disables the submit button again', async () => {
    await renderSection();
    await openForm();
    fillForm();
    giveToken();
    act(() => turnstile.live()[0].options['expired-callback']?.());
    expect(submitButton()).toBeDisabled();
  });

  test('without a token a forced submit sends nothing', async () => {
    await renderSection();
    await openForm();
    fillForm();
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    await settle();
    expect(posts()).toHaveLength(0);
  });

  test('mismatching emails block the request and say why', async () => {
    await renderSection();
    await openForm();
    fillForm('jean@example.com', 'jeanne@example.com');
    giveToken();
    userEvent.click(submitButton());
    await settle();
    expect(posts()).toHaveLength(0);
    expect(screen.getByText('Les deux adresses email ne correspondent pas.')).toBeInTheDocument();
    expect(confirmInput()).toHaveAttribute('aria-invalid', 'true');
  });

  test('the button is disabled and relabelled while the request is in flight', async () => {
    let release: () => void = () => undefined;
    server.reserve = () => new Promise<Response>((resolve) => { release = () => resolve(okReserve()); });
    await readyToSubmit();
    await submit();
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent('Réservation en cours…');
    release();
    expect(await screen.findByText(SUCCESS_TITLE)).toBeInTheDocument();
  });

  test('submitting twice quickly sends one request', async () => {
    let release: () => void = () => undefined;
    server.reserve = () => new Promise<Response>((resolve) => { release = () => resolve(okReserve()); });
    await readyToSubmit();
    const form = submitButton().closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await settle();
    expect(posts()).toHaveLength(1);
    release();
    await screen.findByText(SUCCESS_TITLE);
    expect(posts()).toHaveLength(1);
  });
});

describe('request', () => {
  test('POSTs /api/reserve as same-origin JSON', async () => {
    await readyToSubmit();
    await submit();
    const [url, init] = posts()[0];
    expect(url).toBe('/api/reserve');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init).not.toHaveProperty('mode');
    expect(init).not.toHaveProperty('credentials');
    await screen.findByText(SUCCESS_TITLE);
  });

  test('the body is exactly {showId, name, email, quantity, turnstileToken, website}', async () => {
    await renderSection();
    await openForm(OTHER_SHOW);
    fillForm();
    userEvent.selectOptions(quantitySelect(), '3');
    giveToken('tok-body');
    await submit();
    expect(sentBody()).toEqual({
      showId: OTHER_SHOW.id,
      name: NAME,
      email: EMAIL,
      quantity: 3,
      turnstileToken: 'tok-body',
      website: '',
    });
    expect(Object.keys(sentBody()).sort()).toEqual(['email', 'name', 'quantity', 'showId', 'turnstileToken', 'website']);
    await screen.findByText(SUCCESS_TITLE);
  });

  test('a filled honeypot is forwarded as typed', async () => {
    await renderSection();
    await openForm();
    fillForm();
    giveToken();
    fireEvent.change(honeypot(), { target: { value: 'http://spam.example' } });
    await submit();
    expect(sentBody().website).toBe('http://spam.example');
    await screen.findByText(SUCCESS_TITLE);
  });
});

describe('success', () => {
  test('asks to check the mailbox, names the address and the deadline, and does not promise seats', async () => {
    const linkExpiresAt = futureIso();
    server.reserve = () => fakeResponse(200, { ok: true, linkExpiresAt });
    await readyToSubmit();
    await submit();
    expect(await screen.findByRole('heading', { name: SUCCESS_TITLE })).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).toContain(EMAIL);
    expect(text).toContain('ne sont pas garanties');
    expect(text).toContain(`avant le ${formatDateTime(Date.parse(linkExpiresAt))}`);
    expect(text).toContain("dans l'ordre des confirmations");
    expect(text).toMatch(/spams/);
    expect(text).not.toMatch(/réservée/);
  });

  test.each([
    ['unparseable', 'pas une date'],
    ['missing', undefined],
    ['far in the past', '2001-01-01T00:00:00.000Z'],
  ])('omits the deadline sentence when linkExpiresAt is %s', async (_label, value) => {
    server.reserve = () => fakeResponse(200, value === undefined ? { ok: true } : { ok: true, linkExpiresAt: value });
    await readyToSubmit();
    await submit();
    await screen.findByRole('heading', { name: SUCCESS_TITLE });
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('avant le');
    expect(text).toContain('ne sont pas garanties');
    expect(text).toContain(EMAIL);
  });

  test('a 200 without ok:true is treated as a failure', async () => {
    server.reserve = () => fakeResponse(200, { fine: 'maybe' });
    await readyToSubmit();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_ERROR);
    expect(screen.queryByText(SUCCESS_TITLE)).not.toBeInTheDocument();
  });

  test('also resets the widget and refetches availability once', async () => {
    await readyToSubmit();
    const spent = turnstile.widgets[0];
    await submit();
    await screen.findByText(SUCCESS_TITLE);
    await waitFor(() => expect(gets()).toBe(2));
    await settle();
    expect(gets()).toBe(2);
    expect(spent.removed).toBe(true);
    expect(turnstile.live()).toHaveLength(0);
  });

  test('"Nouvelle réservation" returns to the hint, and the next form gets a fresh widget and no token', async () => {
    await readyToSubmit();
    await submit();
    userEvent.click(await screen.findByRole('button', { name: 'Nouvelle réservation' }));
    expect(await screen.findByText('Sélectionnez une date pour réserver vos places.')).toBeInTheDocument();
    await openForm();
    expect(turnstile.live()).toEqual([turnstile.widgets[turnstile.widgets.length - 1]]);
    expect(turnstile.widgets.length).toBeGreaterThan(1);
    expect(submitButton()).toBeDisabled();
  });
});

interface ErrorCase {
  name: string;
  respond: () => Promise<Response> | Response;
  text: string | RegExp;
}

const BANNER_CASES: ErrorCase[] = [
  { name: 'captcha 400', respond: () => fakeResponse(400, { error: 'Vérification anti-robot échouée.', code: 'captcha' }), text: 'Vérification anti-robot échouée.' },
  { name: 'full 409', respond: () => fakeResponse(409, { error: 'Plus assez de places.', code: 'full', remaining: 2 }), text: 'Plus assez de places.' },
  { name: 'cooldown 429', respond: () => fakeResponse(429, { error: 'Patientez quelques minutes.', code: 'cooldown', retryAfterSeconds: 540 }), text: /Patientez quelques minutes\..*9 minutes/ },
  { name: 'budget 429', respond: () => fakeResponse(429, { error: 'Trop de demandes aujourd\'hui.', code: 'budget' }), text: "Trop de demandes aujourd'hui." },
  { name: 'bad-address 400', respond: () => fakeResponse(400, { error: 'Adresse email refusée.', code: 'bad-address' }), text: 'Adresse email refusée.' },
  { name: 'email-failed 503', respond: () => fakeResponse(503, { error: "L'email n'a pas pu être envoyé.", code: 'email-failed' }), text: "L'email n'a pas pu être envoyé." },
  { name: 'email-slow 503', respond: () => fakeResponse(503, { error: "L'envoi est lent, vérifiez votre boîte.", code: 'email-slow' }), text: "L'envoi est lent, vérifiez votre boîte." },
  { name: '400 field error without code', respond: () => fakeResponse(400, { error: 'Nom invalide.' }), text: 'Nom invalide.' },
  { name: '403 origin without body', respond: () => fakeResponse(403), text: CLIENT_ERROR },
  { name: '405 without body', respond: () => fakeResponse(405), text: CLIENT_ERROR },
  { name: '413 without body', respond: () => fakeResponse(413), text: CLIENT_ERROR },
  { name: '415 without body', respond: () => fakeResponse(415), text: CLIENT_ERROR },
  { name: '500 without body', respond: () => fakeResponse(500), text: SERVER_ERROR },
  { name: '503 plain', respond: () => fakeResponse(503, { error: 'Service indisponible.' }), text: 'Service indisponible.' },
  { name: '502 HTML body (invalid JSON)', respond: () => fakeResponse(502, '<html>Bad gateway</html>'), text: SERVER_ERROR },
  { name: '400 with an empty error', respond: () => fakeResponse(400, { error: '', code: 'captcha' }), text: CLIENT_ERROR },
  { name: 'fetch rejection', respond: () => Promise.reject(new TypeError('offline')), text: NETWORK_ERROR },
];

const CLOSED_CASES: Array<{ name: string; respond: () => Response }> = [
  { name: 'closed 403 (gate)', respond: () => fakeResponse(403, { error: 'Fermé.', code: 'closed' }) },
  { name: 'closed 409 (show started)', respond: () => fakeResponse(409, { error: 'La représentation a commencé.', code: 'closed' }) },
];

describe('errors', () => {
  test.each(BANNER_CASES)('$name: one widget epoch, token cleared, one availability refetch', async ({ respond, text }) => {
    server.reserve = respond;
    await readyToSubmit();
    const before = turnstile.widgets.length;
    const getsBefore = gets();
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    await waitFor(() => expect(turnstile.widgets).toHaveLength(before + 1));
    expect(turnstile.live()).toEqual([turnstile.widgets[before]]);
    expect(turnstile.widgets[before - 1].removed).toBe(true);
    expect(submitButton()).toBeDisabled();
    giveToken('fresh-token');
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent('Réserver gratuitement');

    await waitFor(() => expect(gets()).toBe(getsBefore + 1));
    await settle();
    expect(gets()).toBe(getsBefore + 1);
    expect(posts()).toHaveLength(1);
  });

  test.each(CLOSED_CASES)('$name: the spent widget is removed, the closed panel replaces the form, one availability refetch', async ({ respond }) => {
    server.reserve = respond;
    await readyToSubmit();
    const spent = turnstile.widgets[0];
    const getsBefore = gets();
    await submit();

    expect(await screen.findByText(CLOSED_COPY.text)).toBeInTheDocument();
    expect(spent.removed).toBe(true);
    expect(turnstile.live()).toHaveLength(0);

    await waitFor(() => expect(gets()).toBe(getsBefore + 1));
    await settle();
    expect(gets()).toBe(getsBefore + 1);
    expect(posts()).toHaveLength(1);
  });

  test('a second attempt after an error sends the fresh token, never the spent one', async () => {
    server.reserve = () => fakeResponse(400, { error: 'Vérification échouée.', code: 'captcha' });
    await readyToSubmit();
    userEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    await screen.findByRole('alert');
    await waitFor(() => expect(turnstile.live()).toHaveLength(1));
    server.reserve = okReserve;
    giveToken('second-token');
    userEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse(String(posts()[0][1]?.body)).turnstileToken).toBe(TOKEN);
    expect(JSON.parse(String(posts()[1][1]?.body)).turnstileToken).toBe('second-token');
    await screen.findByText(SUCCESS_TITLE);
  });

  test('cooldown rounds up to whole minutes and uses the singular', async () => {
    server.reserve = () => fakeResponse(429, { error: 'Patientez.', code: 'cooldown', retryAfterSeconds: 30 });
    await readyToSubmit();
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/dans 1 minute\./);
    expect(alert).not.toHaveTextContent('1 minutes');
  });

  test('cooldown without retryAfterSeconds shows the server text only', async () => {
    server.reserve = () => fakeResponse(429, { error: 'Patientez.', code: 'cooldown' });
    await readyToSubmit();
    await submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Patientez.');
  });

  test('full clamps the quantity to what is left and the refetched availability follows', async () => {
    server.reserve = () => {
      server.availability = { ...server.availability, [SHOW.id]: 2 };
      return fakeResponse(409, { error: 'Plus assez de places.', code: 'full', remaining: 2 });
    };
    await renderSection();
    await openForm();
    fillForm();
    userEvent.selectOptions(quantitySelect(), '4');
    giveToken();
    await submit();
    await screen.findByRole('alert');
    await waitFor(() => expect(quantityOptions()).toEqual([1, 2]));
    expect(quantitySelect()).toHaveValue('2');
    expect(showButton(SHOW.label)).toHaveTextContent('Plus que 2 places');
  });

  test('full with nothing left disables the show', async () => {
    server.reserve = () => {
      server.availability = { ...server.availability, [SHOW.id]: 0 };
      return fakeResponse(409, { error: 'Complet.', code: 'full', remaining: 0 });
    };
    await readyToSubmit();
    await submit();
    await screen.findByRole('alert');
    await waitFor(() => expect(showButton(SHOW.label)).toBeDisabled());
    expect(showButton(SHOW.label)).toHaveTextContent('Complet');
    await waitFor(() => expect(turnstile.live()).toHaveLength(1));
    giveToken('again');
    expect(submitButton()).toBeDisabled();
  });

  test('closed switches to the closed panel and disables the shows even if the refetch still says open', async () => {
    server.reserve = () => fakeResponse(403, { error: 'Fermé.', code: 'closed' });
    await readyToSubmit();
    await submit();
    expect(await screen.findByText(CLOSED_COPY.text)).toBeInTheDocument();
    SHOWS.forEach((s) => expect(showButton(s.label)).toBeDisabled());
    expect(screen.queryByRole('button', { name: /Réserver gratuitement/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('typed values survive an error', async () => {
    server.reserve = () => fakeResponse(400, { error: 'Nom invalide.' });
    await readyToSubmit();
    await submit();
    await screen.findByRole('alert');
    expect(nameInput()).toHaveValue(NAME);
    expect(emailInput()).toHaveValue(EMAIL);
    expect(confirmInput()).toHaveValue(EMAIL);
  });

  test('a new submission clears the previous error banner', async () => {
    server.reserve = () => fakeResponse(400, { error: 'Nom invalide.' });
    await readyToSubmit();
    userEvent.click(submitButton());
    await screen.findByRole('alert');
    await waitFor(() => expect(turnstile.live()).toHaveLength(1));
    let release: () => void = () => undefined;
    server.reserve = () => new Promise<Response>((resolve) => { release = () => resolve(okReserve()); });
    giveToken('second');
    userEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    release();
    await screen.findByText(SUCCESS_TITLE);
  });

  test('exactly one refetch per failure across three failures, none on render', async () => {
    server.reserve = () => fakeResponse(400, { error: 'Nom invalide.' });
    await readyToSubmit();
    const failOnce = async (attempt: number) => {
      userEvent.click(submitButton());
      await waitFor(() => expect(posts()).toHaveLength(attempt));
      await waitFor(() => expect(gets()).toBe(1 + attempt));
      await waitFor(() => expect(turnstile.widgets).toHaveLength(1 + attempt));
      giveToken(`token-${attempt}`);
    };
    await failOnce(1);
    await failOnce(2);
    await failOnce(3);
    await settle();
    expect(gets()).toBe(4);
  });
});

describe('safety', () => {
  test('API error text is rendered as text, never as markup', async () => {
    const alertSpy = jest.fn();
    window.alert = alertSpy;
    server.reserve = () => fakeResponse(400, { error: '<img src=x onerror=alert(1)>', code: 'captcha' });
    await readyToSubmit();
    await submit();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
    expect(banner.querySelector('img')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('user-typed values render as text in the success panel', async () => {
    await renderSection();
    await openForm();
    userEvent.type(nameInput(), 'Mallory');
    userEvent.type(emailInput(), 'a<b>@example.com');
    userEvent.type(confirmInput(), 'a<b>@example.com');
    giveToken();
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    await waitFor(() => expect(posts()).toHaveLength(1));
    await screen.findByText(SUCCESS_TITLE);
    expect(document.querySelector('b')).toBeNull();
  });

  test('a full failure and a success write nothing to the console or to storage', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    server.reserve = () => fakeResponse(400, { error: 'Vérification échouée.', code: 'captcha' });
    await readyToSubmit();
    userEvent.click(submitButton());
    await screen.findByRole('alert');
    await waitFor(() => expect(turnstile.live()).toHaveLength(1));
    server.reserve = okReserve;
    giveToken('second');
    userEvent.click(submitButton());
    await screen.findByText(SUCCESS_TITLE);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

describe('source constraints', () => {
  const source = readFileSync(join(__dirname, '../components/sections/TicketingSection.tsx'), 'utf8');

  test('every failure goes through the single fail() function', () => {
    expect(source.match(/function fail\(/g)).toHaveLength(1);
    expect(source.match(/setState\(\{ kind: 'error'/g)).toHaveLength(1);
    expect(source.match(/requestReserve\(/g)).toHaveLength(1);
  });

  test.each(['formatDeadline', 'expiresAt', 'reservationId', 'Impossible de contacter', 'dangerouslySetInnerHTML', 'localStorage', 'sessionStorage', 'jest.isolateModules'])(
    'does not contain %s',
    (literal) => {
      expect(source).not.toContain(literal);
    }
  );

  test('has no console call and no TODO', () => {
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/TODO/);
  });

  test('formats dates only through src/lib/formatDateTime', () => {
    expect(source).toContain("from '../../lib/formatDateTime'");
    expect(source).not.toContain('toLocaleString');
  });
});

describe('guards on the test data', () => {
  test('the generic error constant is distinct from the fallbacks used above', () => {
    expect(new Set([GENERIC_ERROR, CLIENT_ERROR, SERVER_ERROR, NETWORK_ERROR]).size).toBe(4);
  });
});
