'use client';
import { useState, type FormEvent } from 'react';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    // Raw exception text ('Failed to fetch', a JSON SyntaxError) never shows.
    let message = 'Could not reach the shop. Try again.';
    try {
      const response = await fetch(
        `/api/auth/${mode === 'login' ? 'login' : 'register'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname, password }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (typeof body?.error === 'string') message = body.error;
        throw new Error();
      }
      setPassword('');
      // Stay pending while the page navigates, so a second click cannot resend.
      // If the navigation is stopped, the form comes back after a while.
      window.location.assign('/');
      window.setTimeout(() => setPending(false), 8000);
    } catch {
      setError(message);
      setPending(false);
    }
  };

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◒
          </span>
          <span>
            Iroh&apos;s Tea Shop
            <small>NANSEN-POWERED CRYPTO RESEARCH</small>
          </span>
        </div>
        <span className="auth-topbar-note">YOUR ROOM</span>
      </header>
      <div className="auth-layout">
        <div className="auth-atmosphere" aria-hidden="true">
          <div className="auth-enso">◒</div>
          <p>
            Choose a thesis.
            <br />
            Follow the
            <br />
            smart money.
          </p>
          <span>EXPLORE WITHOUT AN ACCOUNT</span>
        </div>
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-panel-inner">
            <span className="eyebrow">YOUR ROOM · SAVED CONVERSATIONS</span>
            <h1 id="auth-title">Let Uncle remember where you left off.</h1>
            <p className="intro">
              Create an account to save your nickname and return to previous
              research conversations. You can explore every station without
              signing in.
            </p>
            <div className="auth-tabs" role="group" aria-label="Account action">
              <button
                type="button"
                className={mode === 'login' ? 'is-active' : ''}
                aria-pressed={mode === 'login'}
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                Log in
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'is-active' : ''}
                aria-pressed={mode === 'register'}
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                Create an account
              </button>
            </div>
            <form onSubmit={submit} className="auth-form">
              <label htmlFor="auth-nickname">Nickname</label>
              <input
                id="auth-nickname"
                name="nickname"
                autoComplete="username"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                minLength={3}
                maxLength={24}
                required
              />
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={mode === 'register' ? 8 : undefined}
                required
              />
              {mode === 'register' && (
                <p className="auth-hint">
                  Nickname: 3–24 letters, numbers, underscores, or hyphens.
                  Password: at least 8 characters.
                </p>
              )}
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="primary auth-submit"
                type="submit"
                disabled={pending}
              >
                {pending
                  ? 'One moment…'
                  : mode === 'login'
                    ? 'Return to my conversations'
                    : 'Create my room'}
                {!pending && <span aria-hidden="true">→</span>}
              </button>
            </form>
            <a className="auth-continue" href="/">
              Continue as a guest
            </a>
            <p className="auth-footnote">
              Your research journey can begin without an account.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
