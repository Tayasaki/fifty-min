import React, { useState } from 'react';
import { Download } from 'lucide-react';
import SEO from '../components/seo/SEO';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { SHOWS } from '../config/shows';

const FALLBACK_FILENAME = 'reservations.csv';

type ExportState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string };

function errorMessageForStatus(status: number): string {
  if (status === 401 || status === 403) return 'Mot de passe incorrect';
  if (status === 503) return 'Export non configuré sur le serveur';
  return 'Erreur, réessayez';
}

/** Reads `filename="..."` from a Content-Disposition header. */
function filenameFromContentDisposition(header: string | null): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || FALLBACK_FILENAME;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Hidden organiser page (no link anywhere): downloads the reservations CSV.
 * The token lives only in React state and travels only in the Authorization header.
 */
export default function AdminPage() {
  const [token, setToken] = useState('');
  const [showId, setShowId] = useState('');
  const [state, setState] = useState<ExportState>({ kind: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: 'loading' });
    const url = '/api/reservations' + (showId ? '?show=' + encodeURIComponent(showId) : '');
    try {
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      });
      if (response.status !== 200) {
        setState({ kind: 'error', message: errorMessageForStatus(response.status) });
        return;
      }
      saveBlob(await response.blob(), filenameFromContentDisposition(response.headers.get('Content-Disposition')));
      setState({ kind: 'idle' });
    } catch {
      setState({ kind: 'error', message: errorMessageForStatus(0) });
    }
  }

  const inputClass =
    'w-full h-11 rounded-lg border border-black/10 bg-white px-4 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-teal/40';

  return (
    <div className="pt-16 bg-background flex-1">
      <SEO title="Espace organisateur" description="Export des réservations." path="/admin" noindex />
      <section className="mx-auto max-w-md px-4 py-16 md:py-24">
        <Card>
          <CardHeader>
            <CardTitle>Export des réservations</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <label className="flex flex-col gap-1.5 text-sm text-text-primary">
                Mot de passe
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm text-text-primary">
                Date
                <select value={showId} onChange={(e) => setShowId(e.target.value)} className={inputClass}>
                  <option value="">Toutes les dates</option>
                  {SHOWS.map((show) => (
                    <option key={show.id} value={show.id}>
                      {show.label}
                    </option>
                  ))}
                </select>
              </label>

              {state.kind === 'error' && (
                <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3">
                  {state.message}
                </p>
              )}

              <Button type="submit" disabled={state.kind === 'loading'}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Télécharger le CSV
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
