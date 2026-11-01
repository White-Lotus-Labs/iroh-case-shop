import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from './validation';

export async function readCredentials(
  request: NextRequest,
): Promise<{ nickname: unknown; password: unknown }> {
  if (Number(request.headers.get('content-length') ?? 0) > 4096) {
    throw new AuthError('Request is too large.', 413);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AuthError('Invalid request body.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthError('Invalid request body.');
  }
  const input = body as Record<string, unknown>;
  return { nickname: input.nickname, password: input.password };
}

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: 'Unable to complete the request.' },
    { status: 500 },
  );
}
