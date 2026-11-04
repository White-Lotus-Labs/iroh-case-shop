import type { EventMap, NearWalletBase } from '@hot-labs/near-connect';
import type { WalletConnector } from './walletController';

export type WalletFunctionCall = {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
};

export class WalletPreflightError extends Error {}

type WalletRuntime = WalletConnector & {
  signFunctionCall(
    accountId: string,
    call: WalletFunctionCall,
    isCurrent?: () => boolean,
  ): Promise<unknown>;
};

/** Recheck the live wallet before every payable Testnet action. */
export async function signTestnetFunctionCall(
  wallet: NearWalletBase,
  accountId: string,
  call: WalletFunctionCall,
  isCurrent: () => boolean = () => true,
): Promise<unknown> {
  if (wallet.manifest.features?.testnet !== true)
    throw new WalletPreflightError(
      'This wallet does not support NEAR Testnet. Choose another wallet.',
    );
  if (!wallet.manifest.features.signAndSendTransaction)
    throw new WalletPreflightError(
      'This wallet cannot sign transactions. Choose another Testnet wallet.',
    );
  if (
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(call.receiverId) ||
    call.receiverId.length > 64
  )
    throw new WalletPreflightError('A Testnet contract is required.');
  if (
    !/^[a-z][a-z0-9_]*$/.test(call.methodName) ||
    !/^[0-9]+$/.test(call.gas) ||
    !/^[0-9]+$/.test(call.deposit)
  )
    throw new WalletPreflightError('Invalid contract call.');
  const accounts = await wallet.getAccounts({ network: 'testnet' });
  if (
    !isCurrent() ||
    !accounts.some((account) => account.accountId === accountId) ||
    accountId === 'near' ||
    accountId.endsWith('.near')
  )
    throw new WalletPreflightError(
      'The wallet account changed. Refresh before signing.',
    );
  return wallet.signAndSendTransaction({
    network: 'testnet',
    signerId: accountId,
    receiverId: call.receiverId,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: call.methodName,
          args: call.args,
          gas: call.gas,
          deposit: call.deposit,
        },
      },
    ],
  });
}

let pending: Promise<WalletRuntime> | null = null;

/** One SDK instance per page, constructed only after the provider mounts. */
export function loadConnector(): Promise<WalletRuntime> {
  pending ??= createConnector().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

function requireTestnet(wallet: NearWalletBase) {
  if (wallet.manifest.features?.testnet !== true) {
    throw new Error(
      'This wallet does not support NEAR Testnet. Choose another wallet.',
    );
  }
}

async function createConnector(): Promise<WalletRuntime> {
  const { NearConnector } = await import('@hot-labs/near-connect');
  const connector = new NearConnector({
    network: 'testnet',
    features: { testnet: true },
    autoConnect: false,
  });
  let selected: NearWalletBase | null = null;
  let signing = false;

  return {
    async signFunctionCall(accountId, call, isCurrent) {
      await connector.whenManifestLoaded;
      if (signing)
        throw new WalletPreflightError(
          'A wallet confirmation is already in progress.',
        );
      signing = true;
      try {
        const wallet =
          selected ?? (await connector.getConnectedWallet()).wallet;
        return await signTestnetFunctionCall(
          wallet,
          accountId,
          call,
          isCurrent,
        );
      } finally {
        signing = false;
      }
    },
    async connect() {
      await connector.whenManifestLoaded;
      // The SDK resolves an empty manifest when both remote sources fail.
      if (connector.availableWallets.length === 0) {
        throw new Error(
          'No wallets available. Reload the page to retry the wallet list.',
        );
      }
      const wallet = await connector.connect();
      requireTestnet(wallet);
      selected = wallet;
      return await wallet.getAccounts();
    },

    async restore() {
      await connector.whenManifestLoaded;
      try {
        // Unlike wallet(), this method preserves unexpected wallet errors.
        const { wallet, accounts } = await connector.getConnectedWallet();
        requireTestnet(wallet);
        selected = wallet;
        return accounts;
      } catch (error) {
        if (
          error instanceof Error &&
          /^(No wallet selected|No accounts found)$/.test(error.message)
        ) {
          return null;
        }
        throw error;
      }
    },

    async disconnect() {
      await connector.whenManifestLoaded;
      // Preserve wallet errors instead of letting SDK wallet() erase them.
      const wallet = selected ?? (await connector.getConnectedWallet()).wallet;
      await connector.disconnect(wallet);
      selected = null;
    },

    onSignIn(listener) {
      const handler = (payload: EventMap['wallet:signIn']) => {
        if (
          !payload.success ||
          payload.wallet.manifest.features?.testnet !== true
        )
          return;
        selected = payload.wallet;
        listener(payload.accounts);
      };
      connector.on('wallet:signIn', handler);
      return () => connector.off('wallet:signIn', handler);
    },

    onSignOut(listener) {
      const handler = () => {
        selected = null;
        listener();
      };
      connector.on('wallet:signOut', handler);
      return () => connector.off('wallet:signOut', handler);
    },
  };
}
