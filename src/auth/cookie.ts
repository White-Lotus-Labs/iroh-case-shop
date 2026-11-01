export const SESSION_COOKIE = 'tea_session';

export function sessionCookieOptions(production: boolean) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: production,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  };
}
