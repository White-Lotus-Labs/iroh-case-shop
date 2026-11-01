import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Each guard answers before the route touches the database.
vi.mock('../src/auth/db', () => ({ db: {} }));
import { POST as login } from '../src/app/api/auth/login/route';
import { POST as logout } from '../src/app/api/auth/logout/route';
import { POST as register } from '../src/app/api/auth/register/route';
import { POST as newChat } from '../src/app/api/iroh/chats/route';

const post = (path: string, headers: Record<string, string>) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: '{"nickname":"attacker","password":"hunter2hunter2"}',
  });

describe('POST routes refuse requests another site can send', () => {
  it.each([
    ['login', '/api/auth/login', login],
    ['register', '/api/auth/register', register],
    ['logout', '/api/auth/logout', logout],
    ['new chat', '/api/iroh/chats', newChat],
  ] as const)('%s refuses a cross-site request', async (_, path, handler) => {
    const response = await handler(
      post(path, {
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      }),
    );
    expect(response.status).toBe(403);
  });

  it.each([
    ['login', '/api/auth/login', login],
    ['register', '/api/auth/register', register],
  ] as const)('%s refuses a plain-form body', async (_, path, handler) => {
    const response = await handler(
      post(path, { 'content-type': 'text/plain' }),
    );
    expect(response.status).toBe(415);
  });
});
