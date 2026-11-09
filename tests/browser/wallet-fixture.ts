/**
 * A stand-in NEAR wallet, injected the way browser extensions announce
 * themselves. It keeps its session in localStorage, so a reload exercises the
 * real session-restore path in HOT Connect and in the app.
 */
export const FAKE_WALLET = `
  (() => {
    const KEY = 'fake-near-wallet-session';
    const accountId = 'tea-guest.testnet';
    const manifest = {
      id: 'fake-testnet-wallet',
      name: 'Fake Testnet Wallet',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>',
      description: 'Test double for a NEAR wallet',
      website: 'https://example.test',
      version: '1.0.0',
      executor: '',
      type: 'injected',
      platform: {},
      permissions: {},
      features: {
        signMessage: true,
        signTransaction: false,
        signAndSendTransaction: false,
        signAndSendTransactions: false,
        signInWithoutAddKey: true,
        signInAndSignMessage: false,
        signInWithFunctionCallKey: false,
        signDelegateActions: false,
        mainnet: false,
        testnet: true,
      },
    };
    const sessions = () => JSON.parse(localStorage.getItem(KEY) ?? '[]');
    const wallet = {
      manifest,
      async signIn(params) {
        if (params.network !== 'testnet' || params.addFunctionCallKey !== undefined) {
          throw new Error('Unexpected network or signing permission');
        }
        const mode = localStorage.getItem('fake-near-wallet-mode');
        if (mode === 'reject') throw new Error('User rejected');
        if (mode === 'delay') await new Promise(resolve => setTimeout(resolve, 600));
        const selected = localStorage.getItem('fake-near-wallet-account') ?? accountId;
        const accounts = [{ accountId: selected }];
        localStorage.setItem(KEY, JSON.stringify(accounts));
        return accounts;
      },
      async signInAndSignMessage() {
        throw new Error('not supported');
      },
      async signOut(params) {
        if (params.network !== 'testnet') throw new Error('Unexpected disconnect network');
        localStorage.removeItem(KEY);
      },
      async getAccounts(params) {
        if (params.network !== 'testnet') throw new Error('Unexpected restore network');
        return sessions();
      },
      async signAndSendTransaction() {
        throw new Error('not supported');
      },
      async signAndSendTransactions() {
        throw new Error('not supported');
      },
      async signMessage() {
        throw new Error('not supported');
      },
      async signDelegateActions() {
        throw new Error('not supported');
      },
    };
    const announce = () =>
      window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet }));
    window.addEventListener('near-selector-ready', announce);
    document.addEventListener('near-selector-ready', announce);
  })();
`;
