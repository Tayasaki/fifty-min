export const NETWORK_ERROR = 'Impossible de contacter le serveur. Merci de réessayer.';
export const GENERIC_ERROR = 'Une erreur est survenue.';
export const CLIENT_ERROR = "Votre demande n'a pas pu être traitée. Vérifiez les informations saisies et réessayez.";
export const SERVER_ERROR = 'Le service est momentanément indisponible. Merci de réessayer plus tard.';

const MAX_MESSAGE_CHARS = 300;
const MAX_BODY_CHARS = 4096;
const CODE_PATTERN = /^[a-z][a-z-]{0,31}$/;
const RESERVATION_ID_PATTERN = /^[A-F0-9]{8}$/;

export type ApiFailure =
  | { kind: 'network' }
  | { kind: 'http'; status: number; code?: string; message?: string; retryAfterSeconds?: number; remaining?: number };

export type ApiResult = { ok: true; data: unknown } | { ok: false; failure: ApiFailure };

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function usableMessage(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_MESSAGE_CHARS ? value : undefined;
}

export function isReservationId(value: string): boolean {
  return RESERVATION_ID_PATTERN.test(value);
}

export async function readApiFailure(res: Response): Promise<ApiFailure> {
  const failure: Extract<ApiFailure, { kind: 'http' }> = { kind: 'http', status: res.status };
  let body: unknown;
  try {
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) return failure;
    body = JSON.parse(text);
  } catch {
    return failure;
  }
  if (!isDict(body)) return failure;

  if (typeof body.code === 'string' && CODE_PATTERN.test(body.code)) failure.code = body.code;
  const message = usableMessage(body.error);
  if (message !== undefined) failure.message = message;
  if (typeof body.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds)) {
    failure.retryAfterSeconds = body.retryAfterSeconds;
  }
  if (typeof body.remaining === 'number' && Number.isInteger(body.remaining) && body.remaining >= 0) {
    failure.remaining = body.remaining;
  }
  return failure;
}

/** The server text is the wording; the fallbacks only cover a missing or unusable body. */
export function failureText(failure: ApiFailure): string {
  if (failure.kind === 'network') return NETWORK_ERROR;
  const message = usableMessage(failure.message);
  if (message !== undefined) return message;
  return failure.status >= 500 ? SERVER_ERROR : CLIENT_ERROR;
}

export function isClosed(failure: ApiFailure): boolean {
  return failure.kind === 'http' && failure.code === 'closed';
}

export function retryMinutes(failure: ApiFailure): number | undefined {
  if (failure.kind !== 'http') return undefined;
  const seconds = failure.retryAfterSeconds;
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.max(1, Math.ceil(seconds / 60));
}

// --- requests ----------------------------------------------------------------

async function request(path: string, init?: RequestInit): Promise<ApiResult> {
  let res: Response;
  try {
    res = init ? await fetch(path, init) : await fetch(path);
  } catch {
    return { ok: false, failure: { kind: 'network' } };
  }
  if (!res.ok) return { ok: false, failure: await readApiFailure(res) };
  try {
    return { ok: true, data: (await res.json()) as unknown };
  } catch {
    return { ok: true, data: null };
  }
}

function postJson(path: string, payload: unknown): Promise<ApiResult> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface ReserveBody {
  showId: string;
  name: string;
  email: string;
  quantity: number;
  turnstileToken: string;
  website: string;
}

export type ReservationActionKind = 'confirm' | 'cancel';

export function requestAvailability(): Promise<ApiResult> {
  return request('/api/availability');
}

export function requestReserve(body: ReserveBody): Promise<ApiResult> {
  return postJson('/api/reserve', body);
}

export function requestReservation(id: string, token: string): Promise<ApiResult> {
  return request(`/api/reservation?${new URLSearchParams({ id, token })}`);
}

export function requestReservationAction(action: ReservationActionKind, id: string, token: string): Promise<ApiResult> {
  return postJson('/api/reservation', { action, id, token });
}

// --- response guards -----------------------------------------------------------

export interface AvailabilitySnapshot {
  availability: Record<string, number>;
  /** null when the server did not say. */
  open: boolean | null;
}

export function parseAvailability(data: unknown): AvailabilitySnapshot | null {
  if (!isDict(data) || !isDict(data.availability)) return null;
  const availability: Record<string, number> = {};
  for (const [showId, value] of Object.entries(data.availability)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) availability[showId] = value;
  }
  return { availability, open: typeof data.open === 'boolean' ? data.open : null };
}

export interface ReserveSuccess {
  /** Epoch milliseconds, or null when the server value is missing or unparseable. */
  linkExpiresAt: number | null;
}

export function parseReserveSuccess(data: unknown): ReserveSuccess | null {
  if (!isDict(data) || data.ok !== true) return null;
  const parsed = typeof data.linkExpiresAt === 'string' ? Date.parse(data.linkExpiresAt) : NaN;
  return { linkExpiresAt: Number.isNaN(parsed) ? null : parsed };
}

interface PreviewBase {
  id: string;
  showId: string;
  name: string;
  quantity: number;
}

export interface ConfirmPreview extends PreviewBase {
  kind: 'confirm';
  status: 'claimable' | 'full' | 'confirmed' | 'closed';
  availability: number;
  open: boolean;
}

export interface CancelPreview extends PreviewBase {
  kind: 'cancel';
  status: 'confirmed' | 'cancelled';
  closed: boolean;
}

export type Preview = ConfirmPreview | CancelPreview;

const CONFIRM_STATUSES: readonly string[] = ['claimable', 'full', 'confirmed', 'closed'];
const CANCEL_STATUSES: readonly string[] = ['confirmed', 'cancelled'];

function readPreviewBase(data: Dict): PreviewBase | null {
  const { id, showId, name, quantity } = data;
  if (typeof id !== 'string' || !isReservationId(id)) return null;
  if (typeof showId !== 'string' || typeof name !== 'string') return null;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) return null;
  return { id, showId, name, quantity };
}

export function parsePreview(data: unknown): Preview | null {
  if (!isDict(data)) return null;
  const base = readPreviewBase(data);
  if (!base || typeof data.status !== 'string') return null;

  if (typeof data.availability === 'number' && Number.isFinite(data.availability) && typeof data.open === 'boolean') {
    if (!CONFIRM_STATUSES.includes(data.status)) return null;
    return { ...base, kind: 'confirm', status: data.status as ConfirmPreview['status'], availability: data.availability, open: data.open };
  }
  if (typeof data.closed === 'boolean') {
    if (!CANCEL_STATUSES.includes(data.status)) return null;
    return { ...base, kind: 'cancel', status: data.status as CancelPreview['status'], closed: data.closed };
  }
  return null;
}

export interface ConfirmResult {
  id: string;
  alreadyConfirmed: boolean;
  /** null: already confirmed, no mail attempted. */
  emailSent: boolean | null;
}

export interface CancelResult {
  id: string;
  alreadyCancelled: boolean;
  emailSent: boolean | null;
}

function readEmailSent(value: unknown): boolean | null | undefined {
  return typeof value === 'boolean' || value === null ? value : undefined;
}

export function parseConfirmResult(data: unknown): ConfirmResult | null {
  if (!isDict(data) || data.ok !== true || data.status !== 'confirmed') return null;
  const emailSent = readEmailSent(data.emailSent);
  if (typeof data.id !== 'string' || !isReservationId(data.id)) return null;
  if (typeof data.alreadyConfirmed !== 'boolean' || emailSent === undefined) return null;
  return { id: data.id, alreadyConfirmed: data.alreadyConfirmed, emailSent };
}

export function parseCancelResult(data: unknown): CancelResult | null {
  if (!isDict(data) || data.ok !== true || data.status !== 'cancelled') return null;
  const emailSent = readEmailSent(data.emailSent);
  if (typeof data.id !== 'string' || !isReservationId(data.id)) return null;
  if (typeof data.alreadyCancelled !== 'boolean' || emailSent === undefined) return null;
  return { id: data.id, alreadyCancelled: data.alreadyCancelled, emailSent };
}
