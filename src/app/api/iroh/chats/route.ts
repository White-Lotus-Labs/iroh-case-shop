import { db } from '../../../../auth/db';
import { crossSiteError } from '../../../../auth/same-origin';
import { createChat, listChats } from '../../../../iroh/history';
import { userFromRequest } from '../../../../iroh/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await userFromRequest(db, request);
  if (!user)
    return Response.json({ error: 'Sign in to view chats.' }, { status: 401 });
  return Response.json(
    { chats: await listChats(db, user.id) },
    {
      headers: { 'cache-control': 'no-store' },
    },
  );
}

export async function POST(request: Request) {
  const refused = crossSiteError(request, { json: false });
  if (refused) return refused;
  const user = await userFromRequest(db, request);
  if (!user)
    return Response.json(
      { error: 'Sign in to create a chat.' },
      { status: 401 },
    );
  const chat = await createChat(db, user.id);
  return Response.json(
    { chat },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}
