import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/auth/cookie';
import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { authErrorResponse, readCredentials } from '@/auth/http';
import { login, revokeSession } from '@/auth/service';

export async function POST(request: NextRequest) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  try {
    const { nickname, password } = await readCredentials(request);
    const oldToken = request.cookies.get(SESSION_COOKIE)?.value;
    const { user, token } = await login(db, nickname, password);
    await revokeSession(db, oldToken);
    const response = NextResponse.json({ user });
    response.cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(process.env.NODE_ENV === 'production'),
    );
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
