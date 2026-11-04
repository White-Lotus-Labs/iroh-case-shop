import type { EventMap, NearWalletBase } from '@hot-labs/near-connect';
import type { WalletConnector } from './walletController';

let pending: Promise<WalletConnector> | null = null;

/** One SDK instance per page, constructed only after the provider mounts. */
export function loadConnector(): Promise<WalletConnector> {
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

async function createConnector(): Promise<WalletConnector> {
  const { NearConnector } = await import('@hot-labs/near-connect');
  const connector = new NearConnector({
    network: 'testnet',
    features: { testnet: true },
    autoConnect: false,
  });
  let selected: NearWalletBase | null = null;

  return {
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
