import { describe, expect, it } from 'vitest';
import { sessionCookieOptions } from '../src/auth/cookie';

describe('authentication cookie', () => {
  it('is HttpOnly, Lax, scoped to the app, and persistent', () => {
    expect(sessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 2_592_000,
    });
  });

  it('requires HTTPS in production', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
