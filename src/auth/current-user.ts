import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './cookie';
import { db } from './db';
import { resolveSession, type PublicUser } from './service';

export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(db, token);
}
