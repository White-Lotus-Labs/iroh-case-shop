import { afterEach, describe, expect, it, vi } from 'vitest';
import { NansenError } from '../src/nansen/client';
import { NansenRequestManager } from '../src/nansen/request-manager';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('NansenRequestManager', () => {
  it('shares a queued and active normal job and detaches one cancelled waiter', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      irohMaxConcurrent: 1,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const gate = deferred<string>();
    const blocker = manager.runNormal('block', () => gate.promise);
    const lease = await manager.acquireIroh();
    const firstAbort = new AbortController();
    const run = vi.fn(async () => 'result');
    const first = manager.runNormal('same', run, firstAbort.signal);
    const second = manager.runNormal('same', run);
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    gate.resolve('done');
    await blocker;
    lease.release();
    expect(await second).toBe('result');
    expect(run).toHaveBeenCalledTimes(1);
    expect(await manager.runNormal('same', run)).toBe('result');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('enforces global and Iroh caps, oldest eligible heads, and FIFO', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      irohMaxConcurrent: 1,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const a = await manager.acquireIroh();
    const gate = deferred<string>();
    const active = manager.runNormal('active', () => gate.promise);
    const order: string[] = [];
    const iroh = manager.acquireIroh().then((lease) => {
      order.push('iroh');
      lease.release();
    });
    const n1 = manager.runNormal('n1', async () => {
      order.push('n1');
      return 1;
    });
    const n2 = manager.runNormal('n2', async () => {
      order.push('n2');
      return 2;
    });
    gate.resolve('done');
    await active;
    await Promise.all([n1, n2]);
    expect(order).toEqual(['n1', 'n2']);
    a.release();
    await iroh;
    expect(order).toEqual(['n1', 'n2', 'iroh']);
  });

  it('reserves a normal-capable global slot even with an excessive Iroh setting', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 1,
      irohMaxConcurrent: 8,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const first = await manager.acquireIroh();
    const second = manager.acquireIroh();
    expect(await manager.runNormal('normal', async () => 'ok')).toBe('ok');
    first.release();
    const later = await second;
    later.release();
  });

  it('does not occupy an upstream slot while admitted Iroh work prepares', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      irohMaxConcurrent: 1,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const gate = deferred<void>();
    let preparing = false;
    const pending = manager.acquireIroh(undefined, async () => {
      preparing = true;
      await gate.promise;
    });
    await tick();
    expect(preparing).toBe(true);
    expect(await manager.runNormal('normal', async () => 'ok')).toBe('ok');
    gate.resolve();
    const lease = await pending;
    lease.release();
  });

  it('rejects full queues and expires queued jobs without calling upstream', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      irohMaxConcurrent: 1,
      normalMaxQueue: 1,
      irohMaxQueue: 1,
      normalMaxQueueWaitMs: 20,
      irohMaxQueueWaitMs: 20,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const lease = await manager.acquireIroh();
    const gate = deferred<string>();
    const active = manager.runNormal('active', () => gate.promise);
    const normal = vi.fn(async () => 1);
    const queued = manager.runNormal('queued', normal);
    const queuedIroh = manager.acquireIroh();
    await expect(manager.runNormal('full', normal)).rejects.toMatchObject({
      status: 503,
    });
    await expect(manager.acquireIroh()).rejects.toMatchObject({ status: 503 });
    await expect(queued).rejects.toMatchObject({ status: 503 });
    await expect(queuedIroh).rejects.toMatchObject({ status: 503 });
    expect(normal).not.toHaveBeenCalled();
    gate.resolve('done');
    await active;
    lease.release();
  });

  it('releases a slot during retry and applies one global 429 cooldown', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      irohMaxConcurrent: 1,
      startsPerSecond: 100,
      startBurst: 100,
      retryBaseDelayMs: 1,
    });
    let attempts = 0;
    const lease = await manager.acquireIroh();
    const started: string[] = [];
    const retried = manager.runNormal('retry', async () => {
      started.push('retry');
      if (++attempts === 1) throw new NansenError('rate', 429, 30);
      return 'ok';
    });
    await tick();
    const other = manager.runNormal('other', async () => {
      started.push('other');
      return 'other';
    });
    expect(await retried).toBe('ok');
    expect(await other).toBe('other');
    expect(started).toEqual(['retry', 'other', 'retry']);
    lease.release();
  });

  it('never retries ordinary 4xx or Iroh leases', async () => {
    const manager = new NansenRequestManager({
      startsPerSecond: 100,
      startBurst: 100,
    });
    const run = vi.fn(async () => {
      throw new NansenError('bad', 400);
    });
    await expect(manager.runNormal('bad', run)).rejects.toMatchObject({
      status: 400,
    });
    expect(run).toHaveBeenCalledTimes(1);
    const lease = await manager.acquireIroh();
    lease.noteRateLimit(1);
    lease.release();
  });

  it('chooses the oldest eligible lane head and preserves normal FIFO', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      irohMaxConcurrent: 1,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const blocker = await manager.acquireIroh();
    const gate = deferred<string>();
    const active = manager.runNormal('active', () => gate.promise);
    const order: string[] = [];
    const olderIroh = manager.acquireIroh().then((lease) => {
      order.push('iroh');
      lease.release();
    });
    const normalA = manager.runNormal('a', async () => {
      order.push('a');
      return 1;
    });
    const normalB = manager.runNormal('b', async () => {
      order.push('b');
      return 2;
    });
    blocker.release();
    await Promise.all([olderIroh, normalA, normalB]);
    expect(order).toEqual(['iroh', 'a', 'b']);
    gate.resolve('done');
    await active;
  });

  it('cancels a queued normal job before it reaches upstream', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const lease = await manager.acquireIroh();
    const gate = deferred<string>();
    const active = manager.runNormal('active', () => gate.promise);
    const controller = new AbortController();
    const run = vi.fn(async () => 'never');
    const pending = manager.runNormal('queued', run, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    lease.release();
    gate.resolve('done');
    await active;
    await tick();
    expect(run).not.toHaveBeenCalled();
  });

  it('aborts an active normal request when its last waiter leaves', async () => {
    const manager = new NansenRequestManager({
      startsPerSecond: 100,
      startBurst: 100,
    });
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const pending = manager.runNormal(
      'active',
      (signal) => {
        upstreamSignal = signal;
        return new Promise<string>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('cancel', 'AbortError')),
            { once: true },
          ),
        );
      },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(await manager.runNormal('next', async () => 'ok')).toBe('ok');
  });

  it('paces request starts without occupying a slot during token refill', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      startsPerSecond: 20,
      startBurst: 1,
    });
    const started: number[] = [];
    await Promise.all([
      manager.runNormal('a', async () => {
        started.push(Date.now());
        return 1;
      }),
      manager.runNormal('b', async () => {
        started.push(Date.now());
        return 2;
      }),
    ]);
    expect(started).toHaveLength(2);
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(40);
  });

  it('retries network and 5xx once, while letting other jobs use the backoff slot', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      startsPerSecond: 100,
      startBurst: 100,
      retryBaseDelayMs: 30,
    });
    const order: string[] = [];
    const lease = await manager.acquireIroh();
    let attempts = 0;
    const retried = manager.runNormal('retry', async () => {
      order.push('retry');
      if (++attempts === 1) throw new NansenError('upstream', 503);
      return 'ok';
    });
    const other = manager.runNormal('other', async () => {
      order.push('other');
      return 'other';
    });
    expect(await other).toBe('other');
    expect(await retried).toBe('ok');
    expect(order).toEqual(['retry', 'other', 'retry']);
    const network = vi.fn(async () => {
      throw new NansenError('network', 502, 0, 'network');
    });
    await expect(manager.runNormal('network', network)).rejects.toMatchObject({
      kind: 'network',
    });
    expect(network).toHaveBeenCalledTimes(2);
    lease.release();
  });

  it('blocks both lanes during cooldown without taking an upstream slot', async () => {
    const manager = new NansenRequestManager({
      globalMaxConcurrent: 2,
      startsPerSecond: 100,
      startBurst: 100,
    });
    manager.noteRateLimit(40);
    const started = Date.now();
    const normal = manager.runNormal('normal', async () => Date.now());
    const iroh = manager.acquireIroh();
    const normalAt = await normal;
    const lease = await iroh;
    expect(normalAt - started).toBeGreaterThanOrEqual(30);
    expect(lease.signal.aborted).toBe(false);
    lease.release();
  });

  it('does not replay a 429 beyond the normal job deadline', async () => {
    const manager = new NansenRequestManager({
      normalMaxQueueWaitMs: 20,
      startsPerSecond: 100,
      startBurst: 100,
    });
    const run = vi.fn(async () => {
      throw new NansenError('limited', 429, 100);
    });
    await expect(manager.runNormal('limited', run)).rejects.toMatchObject({
      status: 429,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
