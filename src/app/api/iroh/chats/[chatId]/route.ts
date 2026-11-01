import { db } from '../../../../../auth/db';
import { getChat } from '../../../../../iroh/history';
import { userFromRequest } from '../../../../../iroh/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const user = await userFromRequest(db, request);
  if (!user)
    return Response.json({ error: 'Sign in to view chats.' }, { status: 401 });
  const { chatId } = await params;
  const chat = await getChat(db, user.id, chatId);
  if (!chat)
    return Response.json({ error: 'Chat not found.' }, { status: 404 });
  return Response.json({ chat }, { headers: { 'cache-control': 'no-store' } });
}
