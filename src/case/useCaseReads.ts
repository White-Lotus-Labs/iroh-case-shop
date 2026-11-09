'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaseClient, TestnetTransportError } from './client';

type Read<T> =
  | { status: 'loading'; value?: T }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: string; value?: T };

const publicKeys = ['caseInfo', 'pool'] as const;
const accountKeys = [
  'balance',
  'claimed',
  'claimCost',
  'quote',
  'tokenRegistration',
  'storage',
  'active',
  'history',
] as const;
const readKeys = [...publicKeys, ...accountKeys, 'publicOdds'] as const;
type ReadKey = (typeof readKeys)[number];
type Data<K extends ReadKey> = Awaited<ReturnType<CaseClient[K]>>;
type Reads = { [K in ReadKey]?: Read<Data<K>> };

const pollMs = 20000;
const failurePollMs = 35000;
const concurrentReads = 4;

async function readWithRetry<T>(load: () => Promise<T>, signal: AbortSignal) {
  try {
    return await load();
  } catch (error) {
    if (
      signal.aborted ||
      !(error instanceof TestnetTransportError) ||
      !error.retryable
    )
      throw error;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, 1200);
      function cancel() {
        window.clearTimeout(timer);
        reject(signal.reason);
      }
      signal.addEventListener('abort', cancel, { once: true });
    });
    signal.throwIfAborted();
    return await load();
  }
}

export function useCaseReads(
  client: CaseClient | null,
  accountId: string | null,
) {
  const [snapshot, setSnapshot] = useState<{
    accountId: string | null;
    reads: Reads;
  }>({
    accountId,
    reads: {},
  });
  const [loading, setLoading] = useState(false);
  const run = useRef<(mode: 'manual' | 'mutation') => void>(() => {});
  const refresh = useCallback(() => run.current('manual'), []);
  const afterMutation = useCallback(() => run.current('mutation'), []);

  useEffect(() => {
    if (!client) return;
    const scope = new AbortController();
    let running = false;
    let queued = false;
    let timer = 0;
    let lastStart = -Infinity;
    let revision = 0;
    let request = new AbortController();

    setSnapshot(({ reads }) => ({
      accountId,
      reads: { caseInfo: reads.caseInfo, pool: reads.pool },
    }));

    function update<K extends ReadKey>(
      key: K,
      state: (previous?: Read<Data<K>>) => Read<Data<K>>,
    ) {
      if (scope.signal.aborted) return;
      setSnapshot((previous) => ({
        accountId,
        reads: { ...previous.reads, [key]: state(previous.reads[key]) },
      }));
    }

    const cycle = async () => {
      if (running || scope.signal.aborted) return;
      window.clearTimeout(timer);
      running = true;
      lastStart = Date.now();
      const version = revision;
      request = new AbortController();
      const signal = AbortSignal.any([scope.signal, request.signal]);
      let failed = false;
      setLoading(true);

      const task =
        <K extends ReadKey>(key: K, load: () => Promise<Data<K>>) =>
        async () => {
          try {
            const value = await readWithRetry(load, signal);
            if (version === revision)
              update(key, () => ({ status: 'ready', value }));
          } catch (error) {
            if (scope.signal.aborted || version !== revision) return;
            failed = true;
            const message =
              error instanceof Error
                ? error.message
                : 'Unexpected Testnet read error.';
            update(key, (previous) => ({
              status: 'error',
              error: message,
              value: previous?.value,
            }));
          }
        };

      const work = [
        ...(accountId
          ? [
              task('balance', () => client.balance(accountId, signal)),
              task('claimed', () => client.claimed(accountId, signal)),
            ]
          : []),
        task('caseInfo', () => client.caseInfo(signal)),
        task('pool', () => client.pool(signal)),
        ...(accountId
          ? [
              task('claimCost', () => client.claimCost(accountId, signal)),
              task('quote', () => client.quote(accountId, signal)),
              task('tokenRegistration', () =>
                client.tokenRegistration(accountId, signal),
              ),
              task('storage', () => client.storage(accountId, signal)),
              task('active', () => client.active(accountId, signal)),
              task('history', () => client.history(accountId, signal)),
            ]
          : [task('publicOdds', () => client.publicOdds(signal))]),
      ];

      async function worker() {
        while (!scope.signal.aborted && version === revision) {
          const next = work.shift();
          if (!next) return;
          await next();
        }
      }
      await Promise.all(Array.from({ length: concurrentReads }, worker));
      if (scope.signal.aborted) return;
      running = false;
      setLoading(false);
      if (queued) {
        queued = false;
        void cycle();
      } else {
        timer = window.setTimeout(poll, failed ? failurePollMs : pollMs);
      }
    };

    function poll() {
      if (document.visibilityState === 'visible') void cycle();
      else timer = window.setTimeout(poll, pollMs);
    }

    function focus() {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastStart >= 5000 &&
        !running
      )
        void cycle();
    }

    run.current = (mode) => {
      if (mode === 'mutation') {
        revision++;
        request.abort();
        for (const key of accountKeys) {
          update(key, () => ({ status: 'loading' }));
        }
      }
      if (running) queued = true;
      else void cycle();
    };

    queueMicrotask(() => void cycle());
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      scope.abort();
      window.clearTimeout(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [client, accountId]);

  const reads =
    snapshot.accountId === accountId
      ? snapshot.reads
      : { caseInfo: snapshot.reads.caseInfo, pool: snapshot.reads.pool };
  return { reads, loading, refresh, afterMutation };
}
