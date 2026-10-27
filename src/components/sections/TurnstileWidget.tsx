import { useEffect, useRef } from 'react';
import { loadTurnstile } from '../../lib/turnstile';

interface TurnstileWidgetProps {
  siteKey: string;
  /** A token, or null when it expired, timed out or the widget failed. Tokens are single use: remount (change `key`) after each submission. */
  onToken: (token: string | null) => void;
  /** The script could not load or the widget reported an error. Called at most once per mounted widget. */
  onUnavailable: () => void;
}

export default function TurnstileWidget({ siteKey, onToken, onUnavailable }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onToken, onUnavailable });

  useEffect(() => {
    handlers.current = { onToken, onUnavailable };
  });

  useEffect(() => {
    let active = true;
    let reported = false;
    let remove: (() => void) | null = null;

    const reportUnavailable = () => {
      if (!active || reported) return;
      reported = true;
      handlers.current.onUnavailable();
    };
    const setToken = (token: string | null) => {
      if (active) handlers.current.onToken(token);
    };

    loadTurnstile().then(
      (api) => {
        const container = containerRef.current;
        if (!active || !container) return;
        const widgetId = api.render(container, {
          sitekey: siteKey,
          theme: 'light',
          language: 'fr',
          callback: (token) => setToken(token),
          'expired-callback': () => setToken(null),
          'timeout-callback': () => setToken(null),
          'error-callback': () => {
            setToken(null);
            reportUnavailable();
            return true;
          },
        });
        remove = () => api.remove(widgetId);
      },
      reportUnavailable
    );

    return () => {
      active = false;
      remove?.();
    };
  }, [siteKey]);

  return <div ref={containerRef} className="min-h-[65px]" />;
}
