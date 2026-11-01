'use client';
import { useEffect, useRef, useState } from 'react';
import type { PublicUser } from '../auth/service';

export function AccountMenu({ user }: { user: PublicUser | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  // Close like the other popovers: a press outside the menu closes it.
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const details = menu.current;
      if (details && !details.contains(event.target as Node))
        details.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const logout = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      // Full navigation clears client station state and guest chrome reliably.
      window.location.assign('/');
    } catch {
      setError('Could not log out. Please try again.');
      setBusy(false);
    }
  };
  if (!user) {
    return (
      <a
        className="account-entry"
        data-testid="account-entry"
        href="/account"
        aria-label="Log in"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="5.5"
            r="3"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M2.5 13.2c0-2.9 2.5-4.6 5.5-4.6s5.5 1.7 5.5 4.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <span>Log in</span>
      </a>
    );
  }

  return (
    <details
      ref={menu}
      className="account-menu"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        // The shell closes the open panel on Escape; close only this menu.
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}
    >
      <summary
        data-testid="account-control"
        aria-label={`Account: ${user.nickname}`}
      >
        <span className="account-avatar" aria-hidden="true">
          ◒
        </span>
        <span className="account-name">{user.nickname}</span>
        <span className="account-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="account-popover">
        <div className="account-popover-name">{user.nickname}</div>
        <button type="button" onClick={logout} disabled={busy}>
          {busy ? 'Logging out…' : 'Log out'}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
