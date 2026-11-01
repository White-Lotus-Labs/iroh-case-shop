import type { PrismaClient } from '@prisma/client';
import { SESSION_COOKIE } from '../auth/cookie';
import { resolveSession } from '../auth/service';

export async function userFromRequest(db: PrismaClient, request: Request) {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return resolveSession(db, token);
}
