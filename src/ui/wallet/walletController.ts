export type WalletAccount = { accountId: string };
export type WalletAction = 'connect' | 'restore' | 'disconnect';
export type WalletStatus = 'initializing' | 'disconnected' | 'connected';
export type WalletBusy = 'connect' | 'disconnect' | null;

/** The slice of HOT Connect this feature depends on, so tests can stand in for it. */
export type WalletConnector = {
  /** Opens the wallet picker and signs in. Rejects when the guest backs out. */
  connect(): Promise<WalletAccount[]>;
  /** Resolves with a live session's accounts, or null when there is none. */
  restore(): Promise<WalletAccount[] | null>;
  disconnect(): Promise<void>;
  onSignIn(listener: (accounts: WalletAccount[]) => void): () => void;
  onSignOut(listener: () => void): () => void;
};

export type WalletSnapshot = {
  status: WalletStatus;
  accountId: string | null;
  busy: WalletBusy;
  error: string | null;
  notice: string | null;
};

export const INITIAL_WALLET_STATE: WalletSnapshot = {
  status: 'initializing',
  accountId: null,
  busy: null,
  error: null,
  notice: null,
};

const DISCONNECTED: WalletSnapshot = {
  status: 'disconnected',
  accountId: null,
  busy: null,
  error: null,
  notice: null,
};

// Backing out of the wallet picker or its authorization is not a failure.
const CANCELLED = /user rejected|cancell?ed|denied/i;
const NO_WALLET_SERVICE = /manifest|wallet list|wallet not found|no wallets/i;

/**
 * User-facing text for an SDK failure. Returns no message for cancellations so
 * they are never presented as an error.
 */
export function walletErrorFeedback(
  error: unknown,
  action: WalletAction,
): { message: string | null; cancelled: boolean } {
  const text = error instanceof Error ? error.message : '';
  if (CANCELLED.test(text)) return { message: null, cancelled: true };
  if (/does not support NEAR Testnet/i.test(text))
    return {
      message:
        'This wallet does not support NEAR Testnet. Choose another wallet.',
      cancelled: false,
    };
  if (NO_WALLET_SERVICE.test(text))
    return {
      message:
        'Could not reach the NEAR wallet picker. Check your connection and reload the page to try again.',
      cancelled: false,
    };
  if (action === 'disconnect')
    return {
      message: 'The wallet did not confirm disconnecting. Please try again.',
      cancelled: false,
    };
  if (action === 'restore')
    return {
      message: 'Could not restore the saved wallet. Connect again to continue.',
      cancelled: false,
    };
  return {
    message: 'The wallet could not connect. Please try again.',
    cancelled: false,
  };
}

/**
 * Testnet account names never live in the mainnet namespace, so an account
 * ending in `.near` means the wallet answered on the wrong network. Implicit
 * (hex) accounts exist on both networks and are left to the connector's setting.
 */
export function isTestnetAccount(accountId: string) {
  return accountId !== 'near' && !accountId.endsWith('.near');
}

/** Short enough for the top bar; the full ID stays in the popover. */
export function shortAccountId(accountId: string) {
  return accountId.length <= 20
    ? accountId
    : `${accountId.slice(0, 8)}…${accountId.slice(-9)}`;
}

export type WalletControllerOptions = {
  connector: WalletConnector;
  /** Unexpected SDK failures are reported here; wallet data never is. */
  report?: (error: unknown, action: WalletAction) => void;
};

/**
 * Owns the wallet state machine so the React layer only renders a snapshot.
 * Every async result carries a sequence number: anything that finishes after a
 * newer action (or after disposal) is dropped, so a slow restore can never
 * resurrect a session the guest just closed.
 */
export class WalletController {
  #connector: WalletConnector;
  #report: (error: unknown, action: WalletAction) => void;
  #snapshot: WalletSnapshot = INITIAL_WALLET_STATE;
  #listeners = new Set<() => void>();
  #sequence = 0;
  #disposed = false;
  #started = false;
  #rejectingSession = false;
  #detach: Array<() => void> = [];

  constructor({ connector, report }: WalletControllerOptions) {
    this.#connector = connector;
    this.#report =
      report ??
      ((_error, action) => {
        console.error(`NEAR wallet ${action} failed.`);
      });
  }

  getSnapshot = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Restore a saved session, then accept wallet events. Safe to call once. */
  async start() {
    if (this.#disposed || this.#started) return;
    this.#started = true;
    this.#attach();
    const sequence = ++this.#sequence;
    try {
      const accounts = await this.#connector.restore();
      if (this.#stale(sequence)) return;
      // A restored session is held to the same network rule as a fresh one.
      if (accounts) await this.#accept(accounts, sequence);
      else this.#set(DISCONNECTED);
    } catch (error) {
      if (this.#stale(sequence)) return;
      const { message, cancelled } = walletErrorFeedback(error, 'restore');
      if (!cancelled) this.#report(error, 'restore');
      this.#set({ ...DISCONNECTED, error: message });
    }
  }

  async connect() {
    if (this.#disposed) return;
    const current = this.#snapshot;
    // One wallet interaction at a time; connecting twice would open two modals.
    if (current.busy || current.status === 'connected') return;
    const sequence = ++this.#sequence;
    this.#set({
      status:
        current.status === 'initializing' ? 'initializing' : 'disconnected',
      accountId: null,
      busy: 'connect',
      error: null,
      notice: null,
    });
    try {
      const accounts = await this.#connector.connect();
      if (this.#stale(sequence)) return;
      if (accounts.length === 0) {
        this.#set({
          ...DISCONNECTED,
          error: 'The wallet did not share a NEAR account. Try another wallet.',
        });
        return;
      }
      await this.#accept(accounts, sequence);
    } catch (error) {
      if (this.#stale(sequence)) return;
      const { message, cancelled } = walletErrorFeedback(error, 'connect');
      if (!cancelled) this.#report(error, 'connect');
      this.#set({
        ...DISCONNECTED,
        error: message,
        notice: cancelled ? 'Wallet connection cancelled.' : null,
      });
    }
  }

  async disconnect() {
    if (this.#disposed) return;
    const current = this.#snapshot;
    if (current.busy || current.status !== 'connected') return;
    const sequence = ++this.#sequence;
    this.#set({ ...current, busy: 'disconnect', error: null, notice: null });
    try {
      await this.#connector.disconnect();
      if (this.#stale(sequence)) return;
      this.#set(DISCONNECTED);
    } catch (error) {
      if (this.#stale(sequence)) return;
      const { message, cancelled } = walletErrorFeedback(error, 'disconnect');
      if (!cancelled) this.#report(error, 'disconnect');
      // The wallet is still signed in, so the account stays visible.
      this.#set({ ...current, busy: null, error: message });
    }
  }

  /** Clear a message the guest has acknowledged. */
  dismiss() {
    if (this.#disposed || (!this.#snapshot.error && !this.#snapshot.notice))
      return;
    this.#set({ ...this.#snapshot, error: null, notice: null });
  }

  /** Stop listening and ignore any results still in flight. */
  dispose() {
    this.#disposed = true;
    this.#sequence++;
    for (const detach of this.#detach) detach();
    this.#detach = [];
    this.#listeners.clear();
  }

  #attach() {
    if (this.#detach.length > 0) return;
    this.#detach = [
      this.#connector.onSignIn((accounts) => this.#onSignIn(accounts)),
      this.#connector.onSignOut(() => this.#onSignOut()),
    ];
  }

  // A sign-in the guest started from the wallet itself (for example an injected
  // wallet) still counts, unless a connect or disconnect is already in flight.
  #onSignIn(accounts: WalletAccount[]) {
    if (this.#disposed || this.#snapshot.busy) return;
    if (
      !validAccounts(accounts) ||
      !accounts.every((a) => isTestnetAccount(a.accountId))
    )
      return;
    this.#sequence++;
    this.#set(this.#connected(accounts));
  }

  #onSignOut() {
    if (this.#disposed || this.#rejectingSession) return;
    this.#sequence++;
    this.#set(DISCONNECTED);
  }

  #connected(accounts: [WalletAccount, ...WalletAccount[]]): WalletSnapshot {
    return {
      status: 'connected',
      accountId: accounts[0].accountId,
      busy: null,
      error: null,
      notice: null,
    };
  }

  /**
   * Accepts a set of accounts only if every one is on Testnet. A Mainnet
   * session is closed again rather than shown as a misleading connection.
   */
  async #accept(accounts: WalletAccount[], sequence: number) {
    if (!validAccounts(accounts)) {
      this.#set({
        ...DISCONNECTED,
        error:
          'The wallet did not share a valid NEAR account. Try another wallet.',
      });
      return;
    }
    if (accounts.every((account) => isTestnetAccount(account.accountId))) {
      this.#set(this.#connected(accounts));
      return;
    }
    this.#rejectingSession = true;
    try {
      await this.#connector.disconnect();
    } catch (error) {
      this.#report(error, 'disconnect');
    } finally {
      this.#rejectingSession = false;
    }
    if (this.#stale(sequence)) return;
    this.#set({
      ...DISCONNECTED,
      error:
        "That account lives on NEAR Mainnet. Iroh's Tea Shop connects to Testnet only.",
    });
  }

  #stale(sequence: number) {
    return this.#disposed || sequence !== this.#sequence;
  }

  #set(next: WalletSnapshot) {
    if (this.#disposed) return;
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}

function validAccounts(
  accounts: unknown,
): accounts is [WalletAccount, ...WalletAccount[]] {
  return (
    Array.isArray(accounts) &&
    accounts.length > 0 &&
    accounts.every(
      (account: unknown) =>
        typeof account === 'object' &&
        account !== null &&
        'accountId' in account &&
        typeof account.accountId === 'string' &&
        account.accountId.length >= 2 &&
        account.accountId.length <= 64 &&
        /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account.accountId),
    )
  );
}
