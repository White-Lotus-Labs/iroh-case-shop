'use client';
import { useEffect, useRef, useState } from 'react';
import { useWallet } from './WalletProvider';
import { shortAccountId } from './walletController';

/**
 * The top-bar wallet control: Connect Wallet while disconnected, the account
 * while connected, with the guest's choice of disconnecting inside the slip.
 * The full account id is always readable in the popover.
 */
export function WalletMenu() {
  const {
    status,
    accountId,
    busy,
    error,
    notice,
    connect,
    disconnect,
    dismiss,
  } = useWallet();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The slip describes this wallet; closing it on disconnect keeps focus sane.
  useEffect(() => {
    if (status !== 'connected' && open) {
      setOpen(false);
      trigger.current?.focus();
    }
  }, [status, open]);

  // Close like the other popovers: a press outside the slip closes it.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target))
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const connected = status === 'connected' && accountId !== null;
  const connecting = busy === 'connect';
  // Restoring a saved session: the button waits instead of inviting a second
  // sign-in, but the label still says what the control does.
  const starting = status === 'initializing';

  const toggle = () => {
    if (!connected) {
      dismiss();
      connect();
      return;
    }
    setOpen((value) => !value);
  };

  return (
    <div
      className="account-menu wallet-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // The shell closes open panels on Escape; close only this slip.
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        type="button"
        ref={trigger}
        className={`wallet-entry${connected ? ' is-connected' : ''}`}
        data-testid="wallet-entry"
        aria-busy={connecting || starting || busy === 'disconnect' || undefined}
        aria-expanded={connected ? open : undefined}
        aria-controls={connected ? 'wallet-slip' : undefined}
        aria-label={
          connected
            ? `NEAR wallet: ${accountId}`
            : 'Connect a NEAR Testnet wallet'
        }
        onClick={toggle}
        disabled={starting || busy !== null}
      >
        {connected ? (
          <>
            <span className="account-avatar" aria-hidden="true">
              ◒
            </span>
            <span className="account-name" title={accountId}>
              {shortAccountId(accountId)}
            </span>
            <span className="account-chevron" aria-hidden="true">
              ⌄
            </span>
          </>
        ) : (
          <>
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="1.6"
                y="4"
                width="12.8"
                height="8.6"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path d="M1.6 7h12.8" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>{connecting ? 'Connecting…' : 'Connect Wallet'}</span>
          </>
        )}
      </button>

      {open && connected && (
        <div className="account-popover wallet-popover" id="wallet-slip">
          <div className="wallet-popover-label">NEAR Testnet</div>
          <div className="account-popover-name" data-testid="wallet-account">
            {accountId}
          </div>
          <button
            type="button"
            onClick={() => {
              dismiss();
              disconnect();
            }}
            disabled={busy !== null}
          >
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}

      {!connected && (error || notice) && (
        <p
          className={`wallet-message${error ? ' is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error ?? notice}
        </p>
      )}
    </div>
  );
}
