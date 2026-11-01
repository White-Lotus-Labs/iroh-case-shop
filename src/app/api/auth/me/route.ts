import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/auth/current-user';
import { authErrorResponse } from '@/auth/http';

export async function GET() {
  try {
    const user = await getCurrentUser();
    return user
      ? NextResponse.json(
          { user },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      : NextResponse.json(
          { error: 'Session expired. Please log in again.' },
          { status: 401, headers: { 'Cache-Control': 'no-store' } },
        );
  } catch (error) {
    return authErrorResponse(error);
  }
}
