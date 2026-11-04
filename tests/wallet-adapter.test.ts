import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Drives the real `@hot-labs/near-connect` package through the app's adapter,
 * with an injected Testnet wallet standing in for an extension. Mocked unit
 * tests cannot catch a renamed SDK method or event; this can.
 */

let failAccounts = false;
let testnetSupported = true;
const accounts: Array<{ accountId: string }> = [];
let browser: EventTarget;

function fakeWallet() {
  return {
    manifest: {
      id: 'fake-testnet-wallet',
      name: 'Fake Testnet Wallet',
      icon: '',
      description: '',
      website: 'https://example.test',
      version: '1.0.0',
      executor: '',
      type: 'injected',
      platform: {},
      permissions: {},
      features: {
        signMessage: true,
        signInWithoutAddKey: true,
        mainnet: false,
        get testnet() {
          return testnetSupported;
        },
      },
    },
    async signIn() {
      accounts.splice(0, accounts.length, { accountId: 'tea-guest.testnet' });
      return [...accounts];
    },
    async getAccounts() {
      if (failAccounts) throw new Error('Wallet service unavailable');
      return [...accounts];
    },
    async signOut() {
      accounts.length = 0;
    },
  };
}

beforeAll(() => {
  // The SDK reads these while constructing, so they exist before the import.
  browser = Object.assign(new EventTarget(), { parent: { postMessage() {} } });
  vi.stubGlobal('window', browser);
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  // The wallet manifest is remote; an empty one keeps this test offline.
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => ({ version: '1.0.0', wallets: [] }),
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('HOT Connect adapter', () => {
  it('restores a real session, forwards sign-out, and clears itself', async () => {
    const { loadConnector } = await import('../src/ui/wallet/nearConnector');
    const connector = await loadConnector();
    // Injected wallets are announced after the connector exists, the way an
    // extension does it: listen for `near-selector-ready`, then announce.
    browser.dispatchEvent(
      new CustomEvent('near-wallet-injected', { detail: fakeWallet() }),
    );

    // No stored wallet yet, so there is nothing to restore.
    expect(await connector.restore()).toBeNull();

    const signOuts: number[] = [];
    const offSignOut = connector.onSignOut(() => signOuts.push(1));

    // Stand in for a previous visit: the SDK remembers the wallet id under
    // `selected-wallet`, and the wallet still holds a session.
    accounts.push({ accountId: 'tea-guest.testnet' });
    localStorage.setItem('selected-wallet', 'fake-testnet-wallet');

    expect(await connector.restore()).toEqual([
      { accountId: 'tea-guest.testnet' },
    ]);

    await connector.disconnect();
    expect(await connector.restore()).toBeNull();
    expect(signOuts).toEqual([1]);

    offSignOut();
    // Sign in again, then disconnect with the listener removed: the SDK must
    // not call it a second time.
    accounts.push({ accountId: 'tea-guest.testnet' });
    localStorage.setItem('selected-wallet', 'fake-testnet-wallet');
    await connector.disconnect();
    expect(signOuts).toEqual([1]);
  });

  it('reports no session when the remembered wallet has no accounts', async () => {
    const { loadConnector } = await import('../src/ui/wallet/nearConnector');
    const connector = await loadConnector();
    localStorage.setItem('selected-wallet', 'fake-testnet-wallet');
    expect(await connector.restore()).toBeNull();
  });
});

describe('adapter restoration regression coverage', () => {
  it('reports wallet session errors instead of hiding them as no session', async () => {
    const { loadConnector } = await import('../src/ui/wallet/nearConnector');
    const connector = await loadConnector();
    localStorage.setItem('selected-wallet', 'fake-testnet-wallet');
    failAccounts = true;
    try {
      await expect(connector.restore()).rejects.toThrow(
        'Wallet service unavailable',
      );
    } finally {
      failAccounts = false;
    }
  });

  it('refuses a remembered wallet that does not advertise Testnet', async () => {
    const { loadConnector } = await import('../src/ui/wallet/nearConnector');
    const connector = await loadConnector();
    localStorage.setItem('selected-wallet', 'fake-testnet-wallet');
    accounts.push({ accountId: 'tea-guest.testnet' });
    testnetSupported = false;
    try {
      await expect(connector.restore()).rejects.toThrow(/Testnet/);
    } finally {
      testnetSupported = true;
      accounts.length = 0;
    }
  });
});
