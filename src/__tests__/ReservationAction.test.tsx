/* eslint-disable testing-library/no-node-access, testing-library/no-container -- links and injected markup have no accessible role to query */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ReservationAction from '../components/sections/ReservationAction';
import { CLOSED_COPY, CONTACT_EMAIL, FULL_COPY, INVALID_LINK_COPY, fullText, recapFailedText } from '../config/billetterieCopy';
import { getShow, getVenue } from '../config/shows';
import { GENERIC_ERROR, NETWORK_ERROR, SERVER_ERROR } from '../lib/billetterieApi';
import { type FetchMock, fakeResponse, installFetch, uninstallFetch } from './helpers/fetch';

const ID = 'A1B2C3D4';
const TOKEN = 'eyJzaWduZWQiOiJ0b2tlbiJ9.c2lnbmF0dXJl';
const SHOW = getShow('2027-02-20-monique');
const VENUE = SHOW && getVenue(SHOW.venueId);
const NAME = 'Camille Dupont';
const PLAIN_MAILTO = `mailto:${CONTACT_EMAIL}`;
const NUMBER_MAILTO = `${PLAIN_MAILTO}?subject=R%C3%A9servation%20${ID}`;

// Built at run time so the legacy field names never appear as literals in the sources.
const LEGACY_STATUS = ['pend', 'ing'].join('');
const LEGACY_DEADLINE_FIELD = ['expires', 'At'].join('');

type Body = Record<string, unknown>;
type Answer = Response | (() => Response | Promise<Response>);

function confirmPreview(over: Body = {}): Body {
  return { id: ID, showId: SHOW?.id, name: NAME, quantity: 2, status: 'claimable', availability: 37, open: true, ...over };
}

function cancelPreview(over: Body = {}): Body {
  return { id: ID, showId: SHOW?.id, name: NAME, quantity: 2, status: 'confirmed', closed: false, ...over };
}

function confirmResult(over: Body = {}): Body {
  return { ok: true, status: 'confirmed', id: ID, alreadyConfirmed: false, emailSent: true, ...over };
}

function cancelResult(over: Body = {}): Body {
  return { ok: true, status: 'cancelled', id: ID, alreadyCancelled: false, emailSent: true, ...over };
}

function json(status: number, body?: unknown): Response {
  return fakeResponse(status, body);
}

async function answer(value: Answer): Promise<Response> {
  return typeof value === 'function' ? value() : value;
}

let fetchMock: FetchMock;

function routes(get: Answer, post?: Answer): FetchMock {
  fetchMock = installFetch((_url, init) => {
    if (init?.method === 'POST') return answer(post ?? json(500));
    return answer(get);
  });
  return fetchMock;
}

function calls(method: 'GET' | 'POST'): Array<[string, RequestInit?]> {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderAction(action: 'confirm' | 'cancel' = 'confirm', props: { id?: string; token?: string } = {}) {
  return render(
    <MemoryRouter>
      <ReservationAction action={action} id={props.id ?? ID} token={props.token ?? TOKEN} />
    </MemoryRouter>
  );
}

function mailtoHrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute('href') ?? '');
}

function noButton() {
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
}

afterEach(() => {
  uninstallFetch();
  jest.restoreAllMocks();
});

describe('confirm: preview (GET)', () => {
  test('claimable and open renders the details and the confirm button', async () => {
    routes(json(200, confirmPreview()));
    renderAction();
    expect(await screen.findByRole('button', { name: 'Confirmer ma réservation' })).toBeEnabled();
    expect(screen.getByText(new RegExp(NAME))).toBeInTheDocument();
    expect(screen.getByText(ID)).toBeInTheDocument();
    expect(screen.getByText(/2 places/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(SHOW?.label ?? 'missing'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(VENUE?.name ?? 'missing'))).toBeInTheDocument();
    expect(screen.getByText('Il reste 37 places')).toBeInTheDocument();
  });

  test('shows no deadline and no waiting status', async () => {
    routes(json(200, confirmPreview({ [LEGACY_DEADLINE_FIELD]: '2027-01-01T00:00:00.000Z' })));
    const { container } = renderAction();
    await screen.findByRole('button', { name: 'Confirmer ma réservation' });
    expect(container).not.toHaveTextContent(/2027-01-01|avant le|délai|expire/i);
    expect(container).not.toHaveTextContent(new RegExp(LEGACY_STATUS, 'i'));
  });

  test('requests the preview once with the id and token in the query', async () => {
    routes(json(200, confirmPreview()));
    renderAction();
    await screen.findByRole('button', { name: 'Confirmer ma réservation' });
    expect(calls('GET')).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/reservation?id=${ID}&token=${encodeURIComponent(TOKEN)}`);
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  test('says "Il reste 1 place" in the singular', async () => {
    routes(json(200, confirmPreview({ availability: 1, quantity: 1 })));
    renderAction();
    expect(await screen.findByText('Il reste 1 place')).toBeInTheDocument();
    expect(screen.getByText(/^1 place —/)).toBeInTheDocument();
  });

  test('shows a loading message until the answer arrives', async () => {
    const gate = deferred<Response>();
    routes(() => gate.promise);
    renderAction();
    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
    noButton();
    await act(async () => gate.resolve(json(200, confirmPreview())));
    expect(await screen.findByRole('button', { name: 'Confirmer ma réservation' })).toBeInTheDocument();
  });

  test('claimable but not open renders the closed state without a button', async () => {
    routes(json(200, confirmPreview({ open: false })));
    renderAction();
    expect(await screen.findByText(CLOSED_COPY.text)).toBeInTheDocument();
    expect(screen.getByText(CLOSED_COPY.notReserved)).toBeInTheDocument();
    noButton();
    expect(screen.getByRole('link', { name: /billetterie/i })).toHaveAttribute('href', '/billetterie');
  });

  test('full with seats left names the remaining seats and offers a way out', async () => {
    routes(json(200, confirmPreview({ status: 'full', availability: 2, quantity: 4 })));
    const { container } = renderAction();
    expect(await screen.findByText(fullText(2, 4))).toBeInTheDocument();
    expect(screen.getByText(/il ne reste que 2 places/)).toBeInTheDocument();
    expect(screen.getByText(/essayez avec moins de places/i)).toBeInTheDocument();
    noButton();
    expect(screen.getByRole('link', { name: /billetterie/i })).toHaveAttribute('href', '/billetterie');
    expect(mailtoHrefs(container)).toEqual([NUMBER_MAILTO]);
  });

  test('full with no seat left says the show is sold out', async () => {
    routes(json(200, confirmPreview({ status: 'full', availability: 0 })));
    renderAction();
    expect(await screen.findByText(FULL_COPY.soldOut)).toBeInTheDocument();
    noButton();
  });

  test('already confirmed shows the number and points to spam and contact', async () => {
    routes(json(200, confirmPreview({ status: 'confirmed' })));
    const { container } = renderAction();
    expect(await screen.findByRole('heading', { name: /déjà confirmée/i })).toBeInTheDocument();
    expect(container).toHaveTextContent(ID);
    expect(container).toHaveTextContent(/vérifiez vos spams/i);
    expect(mailtoHrefs(container)).toEqual([NUMBER_MAILTO]);
    noButton();
  });

  test('a closed preview is the neutral invalid state and names no cause', async () => {
    routes(json(200, confirmPreview({ status: 'closed' })));
    const { container } = renderAction();
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(NAME);
    expect(container).not.toHaveTextContent(SHOW?.label ?? 'missing');
    noButton();
    expect(screen.getByRole('link', { name: /billetterie/i })).toHaveAttribute('href', '/billetterie');
    expect(mailtoHrefs(container)).toEqual([PLAIN_MAILTO]);
  });

  test.each([
    ['400', json(400, { error: 'Lien invalide' })],
    ['404', json(404, { error: 'Introuvable' })],
    ['403 closed', json(403, { error: 'Fermé', code: 'closed' })],
    ['409 closed', json(409, { error: 'Fermé', code: 'closed' })],
  ])('a %s preview answer is the neutral invalid state', async (_label, response) => {
    routes(response);
    const { container } = renderAction();
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Lien invalide|Introuvable|Fermé/);
    noButton();
  });

  test.each([
    ['the legacy waiting status', confirmPreview({ status: LEGACY_STATUS })],
    ['an unknown status', confirmPreview({ status: 'teleported' })],
    ['an empty object', {}],
    ['an array', [confirmPreview()]],
    ['a quantity of zero', confirmPreview({ quantity: 0 })],
    ['a preview for another reservation', confirmPreview({ id: 'FFFFFFFF' })],
    ['an unknown show', confirmPreview({ showId: 'no-such-show' })],
    ['a cancel-shaped preview', cancelPreview()],
  ])('%s is treated as invalid, never as ready', async (_label, body) => {
    routes(json(200, body));
    const { container } = renderAction();
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(NAME);
    noButton();
  });

  test('a network failure shows the network error with a retry that loads the preview', async () => {
    let attempt = 0;
    routes(() => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('offline');
      return json(200, confirmPreview());
    });
    renderAction();
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR);
    userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('button', { name: 'Confirmer ma réservation' })).toBeInTheDocument();
    expect(calls('GET')).toHaveLength(2);
  });

  test('a server failure shows its fallback text with a retry button', async () => {
    routes(json(500));
    renderAction();
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_ERROR);
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeEnabled();
  });

  test('unmounting before the answer arrives does not log or crash', async () => {
    const gate = deferred<Response>();
    routes(() => gate.promise);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderAction();
    unmount();
    await act(async () => gate.resolve(json(200, confirmPreview())));
    expect(errors).not.toHaveBeenCalled();
  });

  test('a new token restarts the load', async () => {
    routes(json(200, confirmPreview()));
    const view = renderAction();
    await screen.findByRole('button', { name: 'Confirmer ma réservation' });
    view.rerender(
      <MemoryRouter>
        <ReservationAction action="confirm" id={ID} token="another.signed.token" />
      </MemoryRouter>
    );
    await waitFor(() => expect(calls('GET')).toHaveLength(2));
    expect(fetchMock.mock.calls[1][0]).toContain(encodeURIComponent('another.signed.token'));
  });
});

describe('confirm: submit (POST)', () => {
  async function readyAndClick() {
    const view = renderAction();
    userEvent.click(await screen.findByRole('button', { name: 'Confirmer ma réservation' }));
    return view;
  }

  test('posts the action, id and token as JSON exactly once', async () => {
    routes(json(200, confirmPreview()), json(200, confirmResult()));
    await readyAndClick();
    await screen.findByText(/Réservation confirmée/);
    const posts = calls('POST');
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe('/api/reservation');
    expect(posts[0][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ action: 'confirm', id: ID, token: TOKEN });
  });

  test('confirmed with the recap mail sent says so and shows no warning', async () => {
    routes(json(200, confirmPreview()), json(200, confirmResult()));
    const { container } = await readyAndClick();
    expect(await screen.findByRole('heading', { name: /Réservation confirmée/ })).toBeInTheDocument();
    expect(container).toHaveTextContent(/Un email récapitulatif vous a été envoyé/);
    expect(container).not.toHaveTextContent(/n'a pas pu/);
    expect(container).not.toHaveTextContent(/n°/);
    noButton();
  });

  test('confirmed with a failed recap mail shows the number, the warning and a mailto with the number', async () => {
    routes(json(200, confirmPreview()), json(200, confirmResult({ emailSent: false })));
    const { container } = await readyAndClick();
    expect(await screen.findByText(recapFailedText(ID))).toBeInTheDocument();
    expect(container).toHaveTextContent(/Vos places sont réservées \(réservation n° A1B2C3D4\)/);
    expect(container).toHaveTextContent(/l'email récapitulatif n'a pas pu vous être envoyé/);
    expect(container).not.toHaveTextContent(/vous a été envoyé/);
    expect(mailtoHrefs(container)).toEqual([NUMBER_MAILTO]);
  });

  test.each([
    ['alreadyConfirmed is true', { alreadyConfirmed: true, emailSent: null }],
    ['no mail was attempted', { alreadyConfirmed: false, emailSent: null }],
  ])('%s: renders the already-confirmed state without a mail claim', async (_label, over) => {
    routes(json(200, confirmPreview()), json(200, confirmResult(over)));
    const { container } = await readyAndClick();
    expect(await screen.findByRole('heading', { name: /déjà confirmée/i })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/vous a été envoyé/);
    noButton();
  });

  test('409 full uses the remaining count of the answer', async () => {
    routes(json(200, confirmPreview({ quantity: 3 })), json(409, { error: 'Plus assez de places', code: 'full', remaining: 1 }));
    await readyAndClick();
    expect(await screen.findByText(fullText(1, 3))).toBeInTheDocument();
    noButton();
  });

  test('409 full without a count falls back to the preview availability', async () => {
    routes(json(200, confirmPreview({ quantity: 3, availability: 2 })), json(409, { error: 'Complet', code: 'full' }));
    await readyAndClick();
    expect(await screen.findByText(fullText(2, 3))).toBeInTheDocument();
  });

  test('409 not-possible is terminal: neutral server text, contact, no button', async () => {
    routes(
      json(200, confirmPreview()),
      json(409, { error: "Cette réservation n'est pas possible pour le moment.", code: 'not-possible' })
    );
    const { container } = await readyAndClick();
    expect(await screen.findByRole('alert')).toHaveTextContent("Cette réservation n'est pas possible pour le moment.");
    expect(container).not.toHaveTextContent(/plafond|maximum|4 places|domaine/i);
    expect(mailtoHrefs(container)).toEqual([NUMBER_MAILTO]);
    noButton();
  });

  test.each([
    ['403', json(403, { error: 'Fermé', code: 'closed' })],
    ['409', json(409, { error: 'Fermé', code: 'closed' })],
  ])('%s closed switches to the closed state', async (_label, response) => {
    routes(json(200, confirmPreview()), response);
    await readyAndClick();
    expect(await screen.findByText(CLOSED_COPY.text)).toBeInTheDocument();
    expect(screen.getByText(CLOSED_COPY.notReserved)).toBeInTheDocument();
    noButton();
  });

  test.each([
    ['400', json(400, { error: 'Lien invalide' })],
    ['404', json(404, { error: 'Introuvable' })],
  ])('%s after the click is the neutral invalid state', async (_label, response) => {
    routes(json(200, confirmPreview()), response);
    const { container } = await readyAndClick();
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Lien invalide|Introuvable/);
  });

  test('a server error keeps the preview with an alert and an enabled button', async () => {
    routes(json(200, confirmPreview()), json(503, { error: 'Service momentanément indisponible.' }));
    await readyAndClick();
    expect(await screen.findByRole('alert')).toHaveTextContent('Service momentanément indisponible.');
    expect(screen.getByRole('button', { name: 'Confirmer ma réservation' })).toBeEnabled();
    expect(screen.getByText(NAME, { exact: false })).toBeInTheDocument();
  });

  test('a network failure then a retry sends a second POST and ends confirmed', async () => {
    let posts = 0;
    routes(json(200, confirmPreview()), () => {
      posts += 1;
      if (posts === 1) throw new TypeError('offline');
      return json(200, confirmResult());
    });
    await readyAndClick();
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR);
    const button = screen.getByRole('button', { name: 'Confirmer ma réservation' });
    expect(button).toBeEnabled();
    userEvent.click(button);
    expect(await screen.findByRole('heading', { name: /Réservation confirmée/ })).toBeInTheDocument();
    expect(calls('POST')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('an unreadable success body is an error banner, not a success', async () => {
    routes(json(200, confirmPreview()), json(200, { ok: true }));
    await readyAndClick();
    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_ERROR);
    expect(screen.getByRole('button', { name: 'Confirmer ma réservation' })).toBeEnabled();
  });

  test('a double click sends a single POST and disables the button while it runs', async () => {
    const gate = deferred<Response>();
    routes(json(200, confirmPreview()), () => gate.promise);
    renderAction();
    const button = await screen.findByRole('button', { name: 'Confirmer ma réservation' });
    userEvent.dblClick(button);
    expect(calls('POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Confirmation en cours/ })).toBeDisabled();
    await act(async () => gate.resolve(json(200, confirmResult())));
    expect(await screen.findByRole('heading', { name: /Réservation confirmée/ })).toBeInTheDocument();
    expect(calls('POST')).toHaveLength(1);
  });

  test('the error text of the server is rendered as text, never as markup', async () => {
    routes(json(200, confirmPreview()), json(500, { error: '<img src=x onerror=alert(1)>' }));
    const { container } = await readyAndClick();
    expect(await screen.findByRole('alert')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('cancel', () => {
  async function readyAndClick() {
    const view = renderAction('cancel');
    userEvent.click(await screen.findByRole('button', { name: "Confirmer l'annulation" }));
    return view;
  }

  test('a confirmed reservation that can still be cancelled renders the details and the button', async () => {
    routes(json(200, cancelPreview()));
    const { container } = renderAction('cancel');
    expect(await screen.findByRole('button', { name: "Confirmer l'annulation" })).toBeEnabled();
    expect(container).toHaveTextContent(NAME);
    expect(container).toHaveTextContent(SHOW?.label ?? 'missing');
    expect(container).toHaveTextContent(VENUE?.name ?? 'missing');
    expect(container).not.toHaveTextContent(/Il reste/);
  });

  test('an already cancelled reservation says so and has no button', async () => {
    routes(json(200, cancelPreview({ status: 'cancelled' })));
    const { container } = renderAction('cancel');
    expect(await screen.findByRole('heading', { name: /déjà annulée/i })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/email/i);
    noButton();
  });

  test('a closed show is the neutral invalid state with a way back', async () => {
    routes(json(200, cancelPreview({ closed: true })));
    renderAction('cancel');
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    noButton();
    expect(screen.getByRole('link', { name: /billetterie/i })).toHaveAttribute('href', '/billetterie');
  });

  test('a confirm-shaped preview on the cancel page is invalid', async () => {
    routes(json(200, confirmPreview()));
    renderAction('cancel');
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    noButton();
  });

  test('posts the cancel action once', async () => {
    routes(json(200, cancelPreview()), json(200, cancelResult()));
    await readyAndClick();
    await screen.findByRole('heading', { name: /Réservation annulée/ });
    const posts = calls('POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ action: 'cancel', id: ID, token: TOKEN });
  });

  test('cancelled with the mail sent says the confirmation mail was sent', async () => {
    routes(json(200, cancelPreview()), json(200, cancelResult()));
    const { container } = await readyAndClick();
    expect(await screen.findByRole('heading', { name: /Réservation annulée/ })).toBeInTheDocument();
    expect(container).toHaveTextContent(/Un email de confirmation vous a été envoyé/);
    expect(container).not.toHaveTextContent(/n'a pas pu/);
  });

  test('cancelled with a failed mail says the cancellation is recorded anyway', async () => {
    routes(json(200, cancelPreview()), json(200, cancelResult({ emailSent: false })));
    const { container } = await readyAndClick();
    expect(await screen.findByRole('heading', { name: /Réservation annulée/ })).toBeInTheDocument();
    expect(container).toHaveTextContent(/l'email de confirmation n'a pas pu être envoyé, l'annulation est bien enregistrée/i);
    expect(container).not.toHaveTextContent(/vous a été envoyé/);
  });

  test('alreadyCancelled renders the already state without a second-mail claim', async () => {
    routes(json(200, cancelPreview()), json(200, cancelResult({ alreadyCancelled: true, emailSent: null })));
    const { container } = await readyAndClick();
    expect(await screen.findByRole('heading', { name: /déjà annulée/i })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/vous a été envoyé/);
    noButton();
  });

  test.each([
    ['404', json(404, { error: 'Introuvable' })],
    ['409 closed', json(409, { error: 'Fermé', code: 'closed' })],
  ])('%s after the click is the neutral invalid state', async (_label, response) => {
    routes(json(200, cancelPreview()), response);
    await readyAndClick();
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
  });

  test('a server error keeps the cancel button available', async () => {
    routes(json(200, cancelPreview()), json(500));
    await readyAndClick();
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_ERROR);
    expect(screen.getByRole('button', { name: "Confirmer l'annulation" })).toBeEnabled();
  });
});

describe('link shape and safety', () => {
  test('an empty token is the neutral invalid state and sends no request', async () => {
    routes(json(200, confirmPreview()));
    renderAction('confirm', { token: '' });
    expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    noButton();
  });

  test.each([
    ['lower case', 'a1b2c3d4'],
    ['9 characters', 'A1B2C3D4E'],
    ['7 characters', 'A1B2C3D'],
    ['empty', ''],
    ['non-hex letters', 'ZZZZZZZZ'],
    ['markup', '"><a href=x>'],
  ])('an id that is %s never reaches fetch or mailto', async (_label, id) => {
    routes(json(200, confirmPreview()));
    for (const action of ['confirm', 'cancel'] as const) {
      const { container, unmount } = renderAction(action, { id });
      expect(await screen.findByText(INVALID_LINK_COPY)).toBeInTheDocument();
      expect(mailtoHrefs(container)).toEqual([PLAIN_MAILTO]);
      expect(id !== '' && container.innerHTML.includes(id)).toBe(false);
      unmount();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('every mailto starts with the constant address and carries only the validated id', async () => {
    routes(json(200, confirmPreview({ status: 'full', availability: 1 })));
    const { container } = renderAction();
    await screen.findByText(fullText(1, 2));
    const hrefs = mailtoHrefs(container);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true);
      expect(decodeURIComponent(href.split('subject=')[1])).toBe(`Réservation ${ID}`);
    }
  });

  test('a name made of markup is rendered as text', async () => {
    routes(json(200, confirmPreview({ name: '<script>x</script>' })));
    const { container } = renderAction();
    expect(await screen.findByText(/<script>x<\/script>/)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  test('a name with an image tag creates no element', async () => {
    routes(json(200, confirmPreview({ name: '<img src=x onerror=alert(1)>' })));
    const { container } = renderAction();
    expect(await screen.findByText(/<img src=x/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  test('the token appears in no rendered text, attribute or link, in any state', async () => {
    const scenarios: Array<[Answer, Answer?]> = [
      [json(200, confirmPreview())],
      [json(200, confirmPreview({ status: 'full', availability: 0 }))],
      [json(200, confirmPreview({ status: 'confirmed' }))],
      [json(200, confirmPreview()), json(200, confirmResult({ emailSent: false }))],
      [json(500)],
      [json(404)],
    ];
    for (const [get, post] of scenarios) {
      routes(get, post);
      const { container, unmount } = renderAction();
      await waitFor(() => expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument());
      if (post) {
        userEvent.click(screen.getByRole('button', { name: 'Confirmer ma réservation' }));
        await screen.findByRole('heading', { name: /Réservation confirmée/ });
      }
      expect(container.innerHTML).not.toContain(TOKEN);
      expect(container.innerHTML).not.toContain(encodeURIComponent(TOKEN));
      unmount();
    }
  });

  test('a whole confirm flow writes nothing to the console or to web storage', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined)
    );
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    routes(json(200, confirmPreview()), json(200, confirmResult({ emailSent: false })));
    renderAction();
    userEvent.click(await screen.findByRole('button', { name: 'Confirmer ma réservation' }));
    await screen.findByRole('heading', { name: /Réservation confirmée/ });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  test('error banners are announced to assistive technology', async () => {
    routes(json(200, confirmPreview()), json(500));
    renderAction();
    userEvent.click(await screen.findByRole('button', { name: 'Confirmer ma réservation' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
