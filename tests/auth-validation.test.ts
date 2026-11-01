import { describe, expect, it } from 'vitest';
import { normalizeNickname, validatePassword } from '../src/auth/validation';

describe('account input', () => {
  it('trims display casing and uses a case-insensitive login key', () => {
    expect(normalizeNickname('  Mark  ')).toEqual({
      nickname: 'Mark',
      nicknameKey: 'mark',
    });
    expect(normalizeNickname('mArK').nicknameKey).toBe('mark');
  });

  it.each(['', '  ', 'ab', 'a'.repeat(25), 'bad name', 'bad@name'])(
    'rejects invalid nickname %j',
    (nickname) => expect(() => normalizeNickname(nickname)).toThrow(),
  );

  it('requires at least eight password characters', () => {
    expect(() => validatePassword('short')).toThrow('at least 8');
    expect(() => validatePassword('long enough')).not.toThrow();
  });

  it('rejects passwords bcrypt would silently truncate', () => {
    expect(() => validatePassword('a'.repeat(73))).toThrow('too long');
  });
});
