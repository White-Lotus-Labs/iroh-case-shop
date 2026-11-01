import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { AuthError, normalizeNickname, validatePassword } from './validation';

export type PublicUser = { id: string; nickname: string };
export type AuthResult = { user: PublicUser; token: string };

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(
  db: PrismaClient,
  user: PublicUser,
): Promise<AuthResult> {
  const token = randomBytes(32).toString('base64url');
  // Nothing else reads an expired session, so each new one sweeps them away.
  await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  });
  return { user, token };
}

export async function createAccount(
  db: PrismaClient,
  rawNickname: unknown,
  rawPassword: unknown,
): Promise<AuthResult> {
  const { nickname, nicknameKey } = normalizeNickname(rawNickname);
  const password = validatePassword(rawPassword);
  const passwordHash = await hash(password, 12);
  try {
    const user = await db.user.create({
      data: { nickname, nicknameKey, passwordHash },
      select: { id: true, nickname: true },
    });
    return createSession(db, user);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AuthError('Nickname is already taken.', 409);
    }
    throw error;
  }
}

export async function login(
  db: PrismaClient,
  rawNickname: unknown,
  rawPassword: unknown,
): Promise<AuthResult> {
  const invalid = new AuthError('Invalid nickname or password.', 401);
  let nicknameKey: string;
  try {
    nicknameKey = normalizeNickname(rawNickname).nicknameKey;
  } catch {
    throw invalid;
  }
  if (
    typeof rawPassword !== 'string' ||
    Buffer.byteLength(rawPassword, 'utf8') > 72
  )
    throw invalid;
  const user = await db.user.findUnique({ where: { nicknameKey } });
  if (!user || !(await compare(rawPassword, user.passwordHash))) throw invalid;
  return createSession(db, { id: user.id, nickname: user.nickname });
}

export async function resolveSession(
  db: PrismaClient,
  token: string | undefined,
): Promise<PublicUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, user: { select: { id: true, nickname: true } } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}

export async function revokeSession(
  db: PrismaClient,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
