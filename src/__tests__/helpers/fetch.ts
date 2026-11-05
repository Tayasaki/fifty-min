export type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

const originalFetch = (globalThis as { fetch?: unknown }).fetch;

/** Minimal Response stand-in: jsdom 16 has no Response, and no test may reach the network. */
export function fakeResponse(status: number, body?: unknown): Response {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

export function installFetch(impl: (input: string, init?: RequestInit) => Promise<Response> | Response): FetchMock {
  const mock: FetchMock = jest.fn(async (input: string, init?: RequestInit) => impl(input, init));
  Object.defineProperty(globalThis, 'fetch', { value: mock, configurable: true, writable: true });
  return mock;
}

export function uninstallFetch(): void {
  if (originalFetch === undefined) {
    delete (globalThis as { fetch?: unknown }).fetch;
  } else {
    Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true, writable: true });
  }
}
