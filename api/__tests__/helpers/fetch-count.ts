/** Wraps the current globalThis.fetch and counts calls; call restore() in a finally block. */
export function countFetch(): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    count += 1;
    return original(input, init);
  };
  return {
    calls: () => count,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Runs fn and returns how many HTTP requests it issued. */
export async function fetchCallsOf(fn: () => Promise<unknown>): Promise<number> {
  const counter = countFetch();
  try {
    await fn();
    return counter.calls();
  } finally {
    counter.restore();
  }
}
