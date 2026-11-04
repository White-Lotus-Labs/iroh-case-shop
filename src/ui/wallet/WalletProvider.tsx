'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  loadConnector,
  WalletPreflightError,
  type WalletFunctionCall,
} from './nearConnector';
import {
  WalletController,
  type WalletAction,
  type WalletSnapshot,
} from './walletController';

export type WalletContextValue = WalletSnapshot & {
  connect(): void;
  disconnect(): void;
  dismiss(): void;
  signFunctionCall(
    call: WalletFunctionCall,
    isCurrent?: () => boolean,
  ): Promise<unknown>;
};

// Before the connector exists nothing is connected, but the header must not
// invite a click until the saved session has been checked.
const STARTING: WalletSnapshot = {
  status: 'initializing',
  accountId: null,
  busy: null,
  error: null,
  notice: null,
};

const LOAD_FAILED: WalletSnapshot = {
  status: 'disconnected',
  accountId: null,
  busy: null,
  error:
    'Could not load the NEAR wallet picker. Check your connection and try again.',
  notice: null,
};

const WalletContext = createContext<WalletContextValue | null>(null);

// The message alone: no account ids, keys or SDK payloads in the console.
function report(_error: unknown, action: WalletAction) {
  // SDK error messages can contain wallet payloads; log only the action.
  console.error(`NEAR wallet ${action} failed.`);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<WalletController | null>(null);
  const [startup, setStartup] = useState<WalletSnapshot>(STARTING);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let wallet: WalletController | null = null;

    // A retry starts from the loading state, not from the state of the
    // controller this effect is about to dispose.
    setController(null);

    // The SDK reads `window` while constructing, so it loads after mount only.
    loadConnector().then(
      (connector) => {
        if (!live) return;
        wallet = new WalletController({ connector, report });
        setController(wallet);
        void wallet.start();
      },
      (error: unknown) => {
        if (!live) return;
        report(error, 'restore');
        setStartup(LOAD_FAILED);
      },
    );

    return () => {
      live = false;
      wallet?.dispose();
    };
  }, [attempt]);

  const state = useWalletSnapshot(controller);
  const merged = controller ? state : startup;
  const currentAccount = useRef(merged.accountId);
  currentAccount.current = merged.accountId;

  const connect = useCallback(() => {
    if (controller) return void controller.connect();
    // A failed SDK load is retryable: this restarts the effect above.
    setStartup(STARTING);
    setAttempt((value) => value + 1);
  }, [controller]);

  const disconnect = useCallback(
    () => void controller?.disconnect(),
    [controller],
  );

  const dismiss = useCallback(() => {
    setStartup((value) => ({ ...value, error: null, notice: null }));
    controller?.dismiss();
  }, [controller]);

  const signFunctionCall = useCallback(
    async (
      call: WalletFunctionCall,
      isCurrent: () => boolean = () => true,
    ): Promise<unknown> => {
      if (merged.status !== 'connected' || !merged.accountId || merged.busy)
        throw new WalletPreflightError(
          'Connect a NEAR Testnet wallet before signing.',
        );
      const connector = await loadConnector();
      if (!isCurrent() || currentAccount.current !== merged.accountId)
        throw new WalletPreflightError(
          'The wallet account changed. Refresh before signing.',
        );
      return connector.signFunctionCall(
        merged.accountId,
        call,
        () => isCurrent() && currentAccount.current === merged.accountId,
      );
    },
    [merged.status, merged.accountId, merged.busy],
  );

  return (
    <WalletContext.Provider
      value={{ ...merged, connect, disconnect, dismiss, signFunctionCall }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}

function useWalletSnapshot(controller: WalletController | null) {
  const [state, setState] = useState(STARTING);
  useEffect(() => {
    if (!controller) return;
    // Read after subscribing so no update can land between the two.
    const sync = () => setState(controller.getSnapshot());
    const unsubscribe = controller.subscribe(sync);
    sync();
    return unsubscribe;
  }, [controller]);
  return state;
}
