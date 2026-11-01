import { afterEach, describe, expect, it } from 'vitest';
import {
  clearUserNansenApiKey,
  getUserNansenApiKey,
  setUserNansenApiKey,
  USER_NANSEN_API_KEY_MAX_LENGTH,
  USER_NANSEN_API_KEY_STORAGE,
} from '../src/nansen/user-api-key';

const memory = new Map<string, string>();

function installMemoryStorage() {
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

afterEach(() => {
  memory.clear();
  clearUserNansenApiKey();
});

describe('user Nansen API key store', () => {
  it('stores, reads, and clears a trimmed key', () => {
    installMemoryStorage();
    expect(getUserNansenApiKey()).toBeNull();
    expect(setUserNansenApiKey('  user-secret  ')).toBe(true);
    expect(getUserNansenApiKey()).toBe('user-secret');
    expect(memory.get(USER_NANSEN_API_KEY_STORAGE)).toBe('user-secret');
    clearUserNansenApiKey();
    expect(getUserNansenApiKey()).toBeNull();
  });

  it('rejects empty and overlong keys', () => {
    installMemoryStorage();
    expect(setUserNansenApiKey('')).toBe(false);
    expect(setUserNansenApiKey('   ')).toBe(false);
    expect(
      setUserNansenApiKey('x'.repeat(USER_NANSEN_API_KEY_MAX_LENGTH + 1)),
    ).toBe(false);
    expect(getUserNansenApiKey()).toBeNull();
  });

  it('survives blocked localStorage without throwing', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(getUserNansenApiKey()).toBeNull();
    expect(setUserNansenApiKey('secret')).toBe(false);
    expect(() => clearUserNansenApiKey()).not.toThrow();
  });
});
