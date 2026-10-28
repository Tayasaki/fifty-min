import type { TurnstileApi, TurnstileRenderOptions } from '../../lib/turnstile';

export interface FakeWidget {
  id: string;
  container: HTMLElement | string;
  options: TurnstileRenderOptions;
  removed: boolean;
}

export interface FakeTurnstile {
  api: TurnstileApi;
  widgets: FakeWidget[];
  /** Widgets that were rendered and not removed. */
  live: () => FakeWidget[];
  render: jest.Mock<string, [HTMLElement | string, TurnstileRenderOptions]>;
  remove: jest.Mock<void, [string]>;
  reset: jest.Mock<void, [string?]>;
}

/** Synchronous stand-in for the Cloudflare API: nothing here touches the network. */
export function createFakeTurnstile(): FakeTurnstile {
  const widgets: FakeWidget[] = [];
  const render = jest.fn((container: HTMLElement | string, options: TurnstileRenderOptions): string => {
    const id = `fake-widget-${widgets.length + 1}`;
    widgets.push({ id, container, options, removed: false });
    return id;
  });
  const remove = jest.fn((id: string): void => {
    const widget = widgets.find((w) => w.id === id);
    if (widget) widget.removed = true;
  });
  const reset = jest.fn((): void => undefined);
  return {
    api: { render, remove, reset },
    widgets,
    live: () => widgets.filter((w) => !w.removed),
    render,
    remove,
    reset,
  };
}

export function installFakeTurnstile(): FakeTurnstile {
  const fake = createFakeTurnstile();
  window.turnstile = fake.api;
  return fake;
}

export function uninstallFakeTurnstile(): void {
  delete window.turnstile;
}
