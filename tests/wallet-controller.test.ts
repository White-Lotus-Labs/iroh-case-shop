import { describe, expect, it } from 'vitest';
import {
  INITIAL_WALLET_STATE,
  WalletController,
  isTestnetAccount,
  shortAccountId,
  walletErrorFeedback,
  type WalletAccount,
  type WalletConnector,
} from '../src/ui/wallet/walletController';

const AGENT: WalletAccount = { accountId: 'agent.testnet' };

/** A stand-in for HOT Connect with controllable outcomes and count of calls. */
function fakeConnector(overrides: Partial<WalletConnector> = {}) {
  const signInListeners = new Set<(accounts: WalletAccount[]) => void>();
  const signOutListeners = new Set<() => void>();
  const calls = {
    connect: 0,
    restore: 0,
    disconnect: 0,
    signInSubscriptions: 0,
    signOutSubscriptions: 0,
    unsubscribed: 0,
  };
  const connector: WalletConnector = {
    async connect() {
      calls.connect++;
      return [AGENT];
    },
    async restore() {
      calls.restore++;
      return null;
    },
    async disconnect() {
      calls.disconnect++;
    },
    onSignIn(listener) {
      calls.signInSubscriptions++;
      signInListeners.add(listener);
      return () => {
        calls.unsubscribed++;
        signInListeners.delete(listener);
      };
    },
    onSignOut(listener) {
      calls.signOutSubscriptions++;
      signOutListeners.add(listener);
      return () => {
        calls.unsubscribed++;
        signOutListeners.delete(listener);
      };
    },
    ...overrides,
  };
  return {
    connector,
    calls,
    emitSignIn: (accounts: WalletAccount[]) =>
      signInListeners.forEach((listener) => listener(accounts)),
    emitSignOut: () => signOutListeners.forEach((listener) => listener()),
    listenerCounts: () => [signInListeners.size, signOutListeners.size],
  };
}

function controller(fake = fakeConnector()) {
  const reports: Array<{ action: string; message: string }> = [];
  const wallet = new WalletController({
    connector: fake.connector,
    report: (error, action) =>
      reports.push({
        action,
        message: error instanceof Error ? error.message : String(error),
      }),
  });
  return { wallet, fake, reports };
}

describe('wallet state machine', () => {
  it('starts initializing and reports a disconnected state with no session', async () => {
    const { wallet } = controller();
    expect(wallet.getSnapshot()).toEqual(INITIAL_WALLET_STATE);
    await wallet.start();
    expect(wallet.getSnapshot()).toEqual({
      status: 'disconnected',
      accountId: null,
      busy: null,
      error: null,
      notice: null,
    });
  });

  it('connects, shows the account, and clears its busy flag', async () => {
    const { wallet, fake } = controller();
    await wallet.start();
    const pending = wallet.connect();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      busy: 'connect',
      accountId: null,
    });
    await pending;
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'connected',
      accountId: 'agent.testnet',
      busy: null,
      error: null,
    });
    expect(fake.calls.connect).toBe(1);
  });

  it('treats a cancelled picker as a notice, not an error', async () => {
    const fake = fakeConnector({
      connect: async () => {
        throw new Error('User rejected');
      },
    });
    const { wallet, reports } = controller(fake);
    await wallet.start();
    await wallet.connect();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
      busy: null,
      error: null,
      notice: 'Wallet connection cancelled.',
    });
    expect(reports).toEqual([]);
  });

  it('explains an empty account list instead of showing a connection', async () => {
    const fake = fakeConnector({ connect: async () => [] });
    const { wallet } = controller(fake);
    await wallet.start();
    await wallet.connect();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
    });
    expect(wallet.getSnapshot().error).toMatch(/did not share a NEAR account/);
  });

  it('reports an exception, keeps the guest disconnected, and logs it once', async () => {
    const fake = fakeConnector({
      connect: async () => {
        throw new Error('Failed to load manifest');
      },
    });
    const { wallet, reports } = controller(fake);
    await wallet.start();
    await wallet.connect();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
      busy: null,
    });
    expect(wallet.getSnapshot().error).toMatch(/wallet picker/);
    expect(reports).toHaveLength(1);
  });

  it('never shows a mainnet account as connected and signs it out again', async () => {
    const fake = fakeConnector({
      connect: async () => [{ accountId: 'agent.near' }],
    });
    const { wallet } = controller(fake);
    await wallet.start();
    await wallet.connect();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
    });
    expect(wallet.getSnapshot().error).toMatch(/Testnet only/);
    expect(fake.calls.disconnect).toBe(1);
  });

  it('disconnects back to the neutral disconnected state', async () => {
    const { wallet, fake } = controller();
    await wallet.start();
    await wallet.connect();
    const pending = wallet.disconnect();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'connected',
      accountId: 'agent.testnet',
      busy: 'disconnect',
    });
    await pending;
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
      busy: null,
      error: null,
    });
    expect(fake.calls.disconnect).toBe(1);
  });

  it('keeps the account visible when the wallet refuses to disconnect', async () => {
    const fake = fakeConnector({
      disconnect: async () => {
        throw new Error('Popup closed');
      },
    });
    const { wallet, reports } = controller(fake);
    await wallet.start();
    await wallet.connect();
    await wallet.disconnect();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'connected',
      accountId: 'agent.testnet',
      busy: null,
    });
    expect(wallet.getSnapshot().error).toMatch(/did not confirm disconnecting/);
    expect(reports.map((entry) => entry.action)).toEqual(['disconnect']);
  });

  it('restores a live session without prompting', async () => {
    const fake = fakeConnector({ restore: async () => [AGENT] });
    const { wallet, reports } = controller(fake);
    expect(wallet.getSnapshot().status).toBe('initializing');
    await wallet.start();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'connected',
      accountId: 'agent.testnet',
    });
    // Restoring must not open the picker.
    expect(fake.calls.connect).toBe(0);
    expect(reports).toEqual([]);
  });

  it('shows a readable message when restoring fails', async () => {
    const fake = fakeConnector({
      restore: async () => {
        throw new Error('Wallet is offline');
      },
    });
    const { wallet, reports } = controller(fake);
    await wallet.start();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
    });
    expect(wallet.getSnapshot().error).toMatch(/Could not restore/);
    expect(reports).toHaveLength(1);
  });

  it('refuses a restored mainnet session and closes it again', async () => {
    const fake = fakeConnector({
      restore: async () => [{ accountId: 'leftover.near' }],
    });
    const { wallet } = controller(fake);
    await wallet.start();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
    });
    expect(wallet.getSnapshot().error).toMatch(/Testnet only/);
    expect(fake.calls.disconnect).toBe(1);
  });

  it('ignores a second connect while the first one is open', async () => {
    let release: ((accounts: WalletAccount[]) => void) | null = null;
    let opened = 0;
    const fake = fakeConnector({
      connect: () => {
        opened++;
        return new Promise<WalletAccount[]>((resolve) => {
          release = resolve;
        });
      },
    });
    const { wallet } = controller(fake);
    await wallet.start();
    const first = wallet.connect();
    // One wallet popup at most, however often the button is pressed.
    await wallet.connect();
    expect(opened).toBe(1);
    release!([AGENT]);
    await first;
    expect(wallet.getSnapshot().status).toBe('connected');
    // A connected wallet does not open the picker again either.
    await wallet.connect();
    expect(opened).toBe(1);
  });

  it('subscribes once and removes its listeners on dispose', async () => {
    const { wallet, fake } = controller();
    await wallet.start();
    await wallet.start();
    expect(fake.calls.signInSubscriptions).toBe(1);
    expect(fake.calls.signOutSubscriptions).toBe(1);
    expect(fake.listenerCounts()).toEqual([1, 1]);
    wallet.dispose();
    expect(fake.listenerCounts()).toEqual([0, 0]);
    expect(fake.calls.unsubscribed).toBe(2);
  });

  it('clears the account when the wallet signs out on its own', async () => {
    const { wallet, fake } = controller();
    await wallet.start();
    await wallet.connect();
    fake.emitSignOut();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
    });
  });

  it('accepts an external sign-in for a testnet account only', async () => {
    const { wallet, fake } = controller();
    await wallet.start();
    fake.emitSignIn([{ accountId: 'mainnet.near' }]);
    expect(wallet.getSnapshot().status).toBe('disconnected');
    fake.emitSignIn([{ accountId: 'other.testnet' }]);
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'connected',
      accountId: 'other.testnet',
    });
  });

  it('drops a restore that finishes after the guest connected', async () => {
    let release: ((accounts: WalletAccount[] | null) => void) | null = null;
    const fake = fakeConnector({
      restore: () =>
        new Promise<WalletAccount[] | null>((resolve) => {
          release = resolve;
        }),
      connect: async () => [{ accountId: 'fresh.testnet' }],
    });
    const { wallet } = controller(fake);
    const starting = wallet.start();
    await wallet.connect();
    release!(null);
    await starting;
    // The late restore must not overwrite the live connection.
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'connected',
      accountId: 'fresh.testnet',
    });
  });

  it('drops results that arrive after dispose', async () => {
    let release: ((accounts: WalletAccount[]) => void) | null = null;
    const fake = fakeConnector({
      connect: () =>
        new Promise<WalletAccount[]>((resolve) => {
          release = resolve;
        }),
    });
    const { wallet } = controller(fake);
    await wallet.start();
    const pending = wallet.connect();
    wallet.dispose();
    release!([AGENT]);
    await pending;
    expect(wallet.getSnapshot().status).toBe('disconnected');
  });

  it('notifies subscribers and lets them leave', async () => {
    const { wallet } = controller();
    let renders = 0;
    const unsubscribe = wallet.subscribe(() => renders++);
    await wallet.start();
    expect(renders).toBe(1);
    unsubscribe();
    await wallet.connect();
    expect(renders).toBe(1);
  });
});

describe('wallet helpers', () => {
  it('distinguishes testnet accounts from mainnet ones', () => {
    expect(isTestnetAccount('agent.testnet')).toBe(true);
    expect(
      isTestnetAccount(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    ).toBe(true);
    expect(isTestnetAccount('agent.near')).toBe(false);
    expect(isTestnetAccount('near')).toBe(false);
  });

  it('abbreviates long ids but leaves short ones readable', () => {
    expect(shortAccountId('agent.testnet')).toBe('agent.testnet');
    expect(shortAccountId('a-very-long-testnet-account.testnet')).toBe(
      'a-very-l…t.testnet',
    );
  });

  it('maps every failure class to readable text', () => {
    expect(walletErrorFeedback(new Error('User rejected'), 'connect')).toEqual({
      message: null,
      cancelled: true,
    });
    expect(
      walletErrorFeedback(new Error('Wallet not found'), 'connect').message,
    ).toMatch(/wallet picker/);
    expect(walletErrorFeedback(new Error('boom'), 'connect').message).toMatch(
      /could not connect/,
    );
    expect(
      walletErrorFeedback(new Error('boom'), 'disconnect').message,
    ).toMatch(/did not confirm disconnecting/);
    expect(walletErrorFeedback(new Error('boom'), 'restore').message).toMatch(
      /Could not restore/,
    );
    expect(walletErrorFeedback('not an error', 'connect').message).toBeTruthy();
  });
});

describe('wallet regression coverage', () => {
  it.each(['', ' ', 'X.testnet', 'a..testnet', 'x', 'a'.repeat(65)])(
    'rejects malformed account %j',
    async (accountId) => {
      const { wallet } = controller(
        fakeConnector({ connect: async () => [{ accountId }] }),
      );
      await wallet.start();
      await wallet.connect();
      expect(wallet.getSnapshot()).toMatchObject({
        status: 'disconnected',
        accountId: null,
      });
      expect(wallet.getSnapshot().error).toMatch(/valid NEAR account/);
    },
  );

  it('does not restore an empty account list as connected', async () => {
    const { wallet } = controller(fakeConnector({ restore: async () => [] }));
    await wallet.start();
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
    });
  });

  it('lets sign-out invalidate a pending restore', async () => {
    const restore = Promise.withResolvers<WalletAccount[] | null>();
    const fake = fakeConnector({ restore: () => restore.promise });
    const { wallet } = controller(fake);
    const pending = wallet.start();
    fake.emitSignOut();
    restore.resolve([AGENT]);
    await pending;
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
    });
  });

  it('lets sign-out invalidate a pending connection', async () => {
    const connection = Promise.withResolvers<WalletAccount[]>();
    const fake = fakeConnector({ connect: () => connection.promise });
    const { wallet } = controller(fake);
    await wallet.start();
    const pending = wallet.connect();
    fake.emitSignOut();
    connection.resolve([AGENT]);
    await pending;
    expect(wallet.getSnapshot()).toMatchObject({
      status: 'disconnected',
      accountId: null,
      busy: null,
    });
  });

  it('does not run restoration again after starting', async () => {
    const { wallet, fake } = controller();
    await wallet.start();
    await wallet.connect();
    await wallet.start();
    expect(fake.calls.restore).toBe(1);
    expect(wallet.getSnapshot().accountId).toBe('agent.testnet');
  });
});

describe('SDK event ordering', () => {
  it('keeps the unsupported-network feedback when cleanup emits sign-out', async () => {
    const fake = fakeConnector({
      connect: async () => [{ accountId: 'wrong.near' }],
    });
    fake.connector.disconnect = async () => {
      fake.emitSignOut();
    };
    const { wallet } = controller(fake);
    await wallet.start();
    await wallet.connect();
    expect(wallet.getSnapshot().error).toMatch(/Testnet only/);
  });
});
