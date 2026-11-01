export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function normalizeNickname(value: unknown): {
  nickname: string;
  nicknameKey: string;
} {
  if (typeof value !== 'string') throw new AuthError('Nickname is required.');
  const nickname = value.trim();
  if (!nickname) throw new AuthError('Nickname is required.');
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(nickname)) {
    throw new AuthError(
      'Nickname must be 3–24 letters, numbers, underscores, or hyphens.',
    );
  }
  return { nickname, nicknameKey: nickname.toLowerCase() };
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) {
    throw new AuthError('Password must be at least 8 characters.');
  }
  if (Buffer.byteLength(value, 'utf8') > 72)
    throw new AuthError('Password is too long.');
  return value;
}
