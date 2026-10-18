import { createChatHandler } from '../../../agent/handler';
import { getApp } from '../../../agent/app';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  return createChatHandler(getApp())(req);
}
