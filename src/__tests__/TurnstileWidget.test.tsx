/* eslint-disable testing-library/no-node-access -- the script tag and the widget mount point have no accessible role */
import type { ComponentProps } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import TurnstileWidget from '../components/sections/TurnstileWidget';
import { type FakeTurnstile, installFakeTurnstile, uninstallFakeTurnstile } from './helpers/turnstile';

const SITE_KEY = '1x00000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

let fake: FakeTurnstile;

beforeEach(() => {
  fake = installFakeTurnstile();
});

afterEach(() => {
  document.querySelectorAll('script[src*="challenges.cloudflare.com"]').forEach((script) => {
    script.dispatchEvent(new Event('error'));
    script.remove();
  });
  uninstallFakeTurnstile();
  jest.restoreAllMocks();
});

async function renderWidget(props: Partial<ComponentProps<typeof TurnstileWidget>> = {}) {
  const onToken = jest.fn();
  const onUnavailable = jest.fn();
  const view = render(<TurnstileWidget siteKey={SITE_KEY} onToken={onToken} onUnavailable={onUnavailable} {...props} />);
  await waitFor(() => expect(fake.render).toHaveBeenCalled());
  return { ...view, onToken, onUnavailable };
}

describe('TurnstileWidget', () => {
  test('renders one widget into its container with the site key, light theme and French UI', async () => {
    const { container } = await renderWidget();
    expect(fake.render).toHaveBeenCalledTimes(1);
    const [target, options] = fake.render.mock.calls[0];
    expect(target).toBe(container.firstElementChild);
    expect(options.sitekey).toBe(SITE_KEY);
    expect(options.theme).toBe('light');
    expect(options.language).toBe('fr');
  });

  test('propagates the token from the success callback', async () => {
    const { onToken } = await renderWidget();
    act(() => fake.widgets[0].options.callback?.(TOKEN));
    expect(onToken).toHaveBeenCalledWith(TOKEN);
  });

  test('clears the token when it expires', async () => {
    const { onToken } = await renderWidget();
    act(() => fake.widgets[0].options['expired-callback']?.());
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  test('clears the token on timeout', async () => {
    const { onToken } = await renderWidget();
    act(() => fake.widgets[0].options['timeout-callback']?.());
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  test('clears the token on error and reports unavailable once, even if the error repeats', async () => {
    const { onToken, onUnavailable } = await renderWidget();
    act(() => {
      fake.widgets[0].options['error-callback']?.('110200');
      fake.widgets[0].options['error-callback']?.('110200');
    });
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  test('removes the widget on unmount', async () => {
    const { unmount } = await renderWidget();
    const id = fake.widgets[0].id;
    unmount();
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(fake.remove).toHaveBeenCalledWith(id);
    expect(fake.live()).toHaveLength(0);
  });

  test('a key change renders a second widget and removes the first', async () => {
    const onToken = jest.fn();
    const onUnavailable = jest.fn();
    const { rerender } = render(<TurnstileWidget key="epoch-0" siteKey={SITE_KEY} onToken={onToken} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    rerender(<TurnstileWidget key="epoch-1" siteKey={SITE_KEY} onToken={onToken} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(fake.widgets).toHaveLength(2));
    expect(fake.widgets[0].removed).toBe(true);
    expect(fake.live()).toEqual([fake.widgets[1]]);
  });

  test('reports unavailable once when the script cannot load', async () => {
    uninstallFakeTurnstile();
    const onToken = jest.fn();
    const onUnavailable = jest.fn();
    render(<TurnstileWidget siteKey={SITE_KEY} onToken={onToken} onUnavailable={onUnavailable} />);
    const script = document.querySelector('script[src*="challenges.cloudflare.com"]');
    expect(script).not.toBeNull();
    act(() => {
      script?.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(fake.render).not.toHaveBeenCalled();
  });

  test('does not render a widget when unmounted before the API is ready', async () => {
    const { unmount } = render(<TurnstileWidget siteKey={SITE_KEY} onToken={jest.fn()} onUnavailable={jest.fn()} />);
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fake.render).not.toHaveBeenCalled();
  });

  test('ignores callbacks fired by a widget that was already removed', async () => {
    const { onToken, onUnavailable, unmount } = await renderWidget();
    const options = fake.widgets[0].options;
    unmount();
    act(() => {
      options.callback?.(TOKEN);
      options['error-callback']?.();
    });
    expect(onToken).not.toHaveBeenCalled();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test('never writes the token to the DOM, the console or storage', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = await renderWidget();
    act(() => fake.widgets[0].options.callback?.(TOKEN));
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TOKEN);
  });

  test('uses the latest callbacks without re-rendering the widget', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<TurnstileWidget siteKey={SITE_KEY} onToken={first} onUnavailable={jest.fn()} />);
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    rerender(<TurnstileWidget siteKey={SITE_KEY} onToken={second} onUnavailable={jest.fn()} />);
    act(() => fake.widgets[0].options.callback?.(TOKEN));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(TOKEN);
    expect(fake.widgets).toHaveLength(1);
  });
});
