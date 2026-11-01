import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  createAccount,
  login,
  resolveSession,
  revokeSession,
} from '../src/auth/service';
import { openTempDb } from './temp-sqlite';

let temp: ReturnType<typeof openTempDb>;
let db: PrismaClient;

beforeEach(() => {
  temp = openTempDb();
  db = temp.db;
});

afterEach(async () => {
  await temp.close();
});

describe('persistent account and session', () => {
  it('creates two stable, distinct UUID identities and hashes passwords', async () => {
    const mark = await createAccount(db, ' Mark ', 'correct horse');
    const alex = await createAccount(db, 'Alex', 'another secret');
    expect(mark.user.id).toMatch(/^[\da-f-]{36}$/);
    expect(mark.user.id).not.toBe(alex.user.id);
    expect(mark.user).toEqual({ id: mark.user.id, nickname: 'Mark' });
    const saved = await db.user.findUniqueOrThrow({
      where: { id: mark.user.id },
    });
    expect(saved.passwordHash).not.toContain('correct horse');
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(saved.nicknameKey).toBe('mark');
    const again = await login(db, 'mArK', 'correct horse');
    expect(again.user.id).toBe(mark.user.id);
  });

  it('rejects case-insensitive duplicate nicknames', async () => {
    await createAccount(db, 'Mark', 'correct horse');
    await expect(createAccount(db, ' mArK ', 'another secret')).rejects.toThrow(
      'already taken',
    );
  });

  it('uses the same generic error for wrong passwords and unknown nicknames', async () => {
    await createAccount(db, 'Mark', 'correct horse');
    await expect(login(db, 'Mark', 'incorrect')).rejects.toThrow(
      'Invalid nickname or password',
    );
    await expect(login(db, 'Nobody', 'incorrect')).rejects.toThrow(
      'Invalid nickname or password',
    );
  });

  it('stores only a token hash, resolves the owner, and revokes logout', async () => {
    const account = await createAccount(db, 'Mark', 'correct horse');
    const tokenHash = createHash('sha256').update(account.token).digest('hex');
    const session = await db.session.findUniqueOrThrow({
      where: { tokenHash },
    });
    expect(session.tokenHash).not.toBe(account.token);
    expect(session.userId).toBe(account.user.id);
    expect(await resolveSession(db, account.token)).toEqual(account.user);
    expect(await resolveSession(db, 'not-a-token')).toBeNull();
    await revokeSession(db, account.token);
    expect(await resolveSession(db, account.token)).toBeNull();
  });

  it('does not resolve an expired session', async () => {
    const account = await createAccount(db, 'Mark', 'correct horse');
    await db.session.update({
      where: {
        tokenHash: createHash('sha256').update(account.token).digest('hex'),
      },
      data: { expiresAt: new Date(0) },
    });
    expect(await resolveSession(db, account.token)).toBeNull();
  });
});
