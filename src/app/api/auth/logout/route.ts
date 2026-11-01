import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/auth/cookie';
import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { revokeSession } from '@/auth/service';
import { authErrorResponse } from '@/auth/http';

export async function POST(request: NextRequest) {
  const refused = crossSiteError(request, { json: false });
  if (refused) return refused;
  try {
    await revokeSession(db, request.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, '', {
      ...sessionCookieOptions(process.env.NODE_ENV === 'production'),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
