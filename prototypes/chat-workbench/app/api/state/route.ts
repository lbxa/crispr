import { getApp } from '../../../agent/app';
import { buildState } from '../../../agent/state';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const patient = new URL(req.url).searchParams.get('patient') ?? undefined;
  return Response.json(await buildState(getApp(), patient));
}
