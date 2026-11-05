import { defaultDeps } from './_lib/deps';
import { handleReserve } from './_lib/reserve-flow';

export const POST = (request: Request): Promise<Response> => handleReserve(request, defaultDeps());
