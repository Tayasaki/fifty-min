import { defaultDeps } from './_lib/deps';
import { handleReservationGet, handleReservationPost } from './_lib/reservation-flow';

export const GET = (request: Request): Promise<Response> => handleReservationGet(request, defaultDeps());
export const POST = (request: Request): Promise<Response> => handleReservationPost(request, defaultDeps());
