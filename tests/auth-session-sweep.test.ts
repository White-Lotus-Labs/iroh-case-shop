import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createAccount, login, resolveSession } from '../src/auth/service';
import { openTempDb } from './temp-sqlite';

let temp: ReturnType<typeof openTempDb>;

beforeEach(() => {
  temp = openTempDb();
});

afterEach(async () => {
  await temp.close();
});

it('a new session sweeps away expired ones and keeps live ones', async () => {
  const { db } = temp;
  const expired = await createAccount(db, 'Mark', 'correct horse');
  const live = await login(db, 'Mark', 'correct horse');
  await db.session.update({
    where: {
      tokenHash: createHash('sha256').update(expired.token).digest('hex'),
    },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await login(db, 'Mark', 'correct horse');
  expect(await db.session.count()).toBe(2);
  expect(await resolveSession(db, expired.token)).toBeNull();
  expect(await resolveSession(db, live.token)).not.toBeNull();
});
