import { NansenError } from './client';

export type ManagerConfig = {
  globalMaxConcurrent: number;
  irohMaxConcurrent: number;
  normalMaxQueue: number;
  irohMaxQueue: number;
  normalMaxQueueWaitMs: number;
  irohMaxQueueWaitMs: number;
  startsPerSecond: number;
  startBurst: number;
  jsonMaxRetries: number;
  retryBaseDelayMs: number;
};

const positive = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const nonnegative = (name: string, fallback: number) => {
  const raw = process.env[name];
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
};

/** All limits, queues, dedupe, pacing and cooldown are per server process. */
export const defaultManagerConfig = (): ManagerConfig => ({
  globalMaxConcurrent: positive('NANSEN_GLOBAL_MAX_CONCURRENT', 8),
  irohMaxConcurrent: positive('NANSEN_IROH_MAX_CONCURRENT', 2),
  normalMaxQueue: positive('NANSEN_NORMAL_MAX_QUEUE', 48),
  irohMaxQueue: positive('NANSEN_IROH_MAX_QUEUE', 4),
  normalMaxQueueWaitMs: positive('NANSEN_NORMAL_MAX_QUEUE_WAIT_MS', 20_000),
  irohMaxQueueWaitMs: positive('NANSEN_IROH_MAX_QUEUE_WAIT_MS', 15_000),
  startsPerSecond: positive('NANSEN_REQUEST_STARTS_PER_SECOND', 3),
  startBurst: positive('NANSEN_REQUEST_START_BURST', 6),
  jsonMaxRetries: nonnegative('NANSEN_JSON_MAX_RETRIES', 1),
  retryBaseDelayMs: positive('NANSEN_JSON_RETRY_BASE_DELAY_MS', 500),
});

export class NansenManagerError extends Error {
  constructor(
    message: string,
    public status: number = 503,
  ) {
    super(message);
  }
}

const waitedTooLong = () =>
  new NansenManagerError('Nansen request waited too long.');

function abortError() {
  return new DOMException('The request was cancelled.', 'AbortError');
}

type Waiter<T> = {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type NormalJob<T = unknown> = {
  lane: 'normal';
  key: string;
  queuedAt: number;
  sequence: number;
  deadline: number;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<T>;
  waiters: Set<Waiter<T>>;
  attempts: number;
  state: 'queued' | 'active' | 'backoff' | 'done';
  timer?: ReturnType<typeof setTimeout>;
};

export type IrohLease = {
  signal: AbortSignal;
  release: () => void;
  noteRateLimit: (retryAfterMs: number) => void;
};

type IrohJob = {
  lane: 'iroh';
  queuedAt: number;
  sequence: number;
  deadline: number;
  controller: AbortController;
  prepare?: (signal: AbortSignal) => Promise<void>;
  prepared: boolean;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (lease: IrohLease) => void;
  reject: (error: unknown) => void;
  state: 'queued' | 'preparing' | 'active' | 'done';
  timer?: ReturnType<typeof setTimeout>;
};

export class NansenRequestManager {
  private config: ManagerConfig;
  private normalQueue: NormalJob<any>[] = [];
  private irohQueue: IrohJob[] = [];
  private normalJobs = new Map<string, NormalJob<any>>();
  private active = 0;
  private activeIroh = 0;
  private preparingIroh = 0;
  private cooldownUntil = 0;
  private nextSequence = 0;
  private tokens: number;
  private tokenAt = Date.now();
  private wake?: ReturnType<typeof setTimeout>;

  constructor(config: Partial<ManagerConfig> = {}) {
    this.config = { ...defaultManagerConfig(), ...config };
    this.config.globalMaxConcurrent = Math.max(
      2,
      Math.floor(this.config.globalMaxConcurrent),
    );
    this.config.irohMaxConcurrent = Math.max(
      1,
      Math.min(
        Math.floor(this.config.irohMaxConcurrent),
        this.config.globalMaxConcurrent - 1,
      ),
    );
    this.tokens = this.config.startBurst;
  }

  runNormal<T>(
    key: string,
    run: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    let job = this.normalJobs.get(key) as NormalJob<T> | undefined;
    if (!job) {
      if (this.normalQueue.length >= this.config.normalMaxQueue)
        return Promise.reject(
          new NansenManagerError('Nansen request queue is full.'),
        );
      const now = Date.now();
      job = {
        lane: 'normal',
        key,
        queuedAt: now,
        sequence: this.nextSequence++,
        deadline: now + this.config.normalMaxQueueWaitMs,
        controller: new AbortController(),
        run,
        waiters: new Set(),
        attempts: 0,
        state: 'queued',
      };
      this.normalJobs.set(key, job as NormalJob<any>);
      this.normalQueue.push(job as NormalJob<any>);
      this.armDeadline(job);
    }
    const target = job;
    const promise = new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, signal };
      waiter.onAbort = () => {
        target.waiters.delete(waiter);
        signal?.removeEventListener('abort', waiter.onAbort!);
        reject(abortError());
        if (!target.waiters.size) this.cancelNormal(target);
      };
      target.waiters.add(waiter);
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
    });
    this.drain();
    return promise;
  }

  acquireIroh(
    signal?: AbortSignal,
    prepare?: (signal: AbortSignal) => Promise<void>,
  ): Promise<IrohLease> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.irohQueue.length + this.preparingIroh >= this.config.irohMaxQueue)
      return Promise.reject(
        new NansenManagerError('Nansen Research queue is full.'),
      );
    return new Promise<IrohLease>((resolve, reject) => {
      const now = Date.now();
      const job: IrohJob = {
        lane: 'iroh',
        queuedAt: now,
        sequence: this.nextSequence++,
        deadline: now + this.config.irohMaxQueueWaitMs,
        controller: new AbortController(),
        prepare,
        prepared: !prepare,
        signal,
        resolve,
        reject,
        state: 'queued',
      };
      job.onAbort = () => {
        job.controller.abort();
        if (job.state === 'queued') {
          this.failIroh(job, abortError());
          this.drain();
        } else if (job.state === 'active') this.releaseIroh(job);
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      this.irohQueue.push(job);
      this.armDeadline(job);
      this.drain();
    });
  }

  noteRateLimit(retryAfterMs: number) {
    this.cooldownUntil = Math.max(
      this.cooldownUntil,
      Date.now() + Math.max(0, retryAfterMs || 1000),
    );
    this.drain();
  }

  private armDeadline(job: NormalJob<any> | IrohJob) {
    job.timer = setTimeout(
      () => {
        if (job.state !== 'queued') return;
        if (job.lane === 'normal')
          this.finishNormal(job, undefined, waitedTooLong());
        else this.failIroh(job, waitedTooLong());
        this.drain();
      },
      Math.max(0, job.deadline - Date.now()),
    );
  }

  private removeIroh(job: IrohJob) {
    if (job.timer) clearTimeout(job.timer);
    const index = this.irohQueue.indexOf(job);
    if (index >= 0) this.irohQueue.splice(index, 1);
  }

  private failIroh(job: IrohJob, error: unknown) {
    this.removeIroh(job);
    job.state = 'done';
    job.signal?.removeEventListener('abort', job.onAbort!);
    job.reject(error);
  }

  private cancelNormal(job: NormalJob<any>) {
    if (job.state === 'done') return;
    job.controller.abort();
    if (this.normalJobs.get(job.key) === job) this.normalJobs.delete(job.key);
    if (job.state !== 'active') this.finishNormal(job, undefined, abortError());
    this.drain();
  }

  private finishNormal<T>(job: NormalJob<T>, value?: T, error?: unknown) {
    if (job.state === 'done') return;
    job.state = 'done';
    if (job.timer) clearTimeout(job.timer);
    const index = this.normalQueue.indexOf(job as NormalJob<any>);
    if (index >= 0) this.normalQueue.splice(index, 1);
    if (this.normalJobs.get(job.key) === job) this.normalJobs.delete(job.key);
    for (const waiter of job.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort!);
      if (error) waiter.reject(error);
      else waiter.resolve(value as T);
    }
    job.waiters.clear();
  }

  private releaseIroh(job: IrohJob) {
    if (job.state !== 'active') return;
    job.state = 'done';
    job.signal?.removeEventListener('abort', job.onAbort!);
    this.active--;
    this.activeIroh--;
    this.drain();
  }

  private async prepareIroh(job: IrohJob) {
    let error: unknown;
    try {
      await job.prepare!(job.controller.signal);
    } catch (caught) {
      error = caught;
    }
    this.preparingIroh--;
    if (job.controller.signal.aborted || error || Date.now() >= job.deadline) {
      this.failIroh(
        job,
        job.controller.signal.aborted
          ? abortError()
          : (error ?? waitedTooLong()),
      );
    } else {
      job.prepared = true;
      job.state = 'queued';
      const next = this.irohQueue.findIndex(
        (item) => item.sequence > job.sequence,
      );
      this.irohQueue.splice(next < 0 ? this.irohQueue.length : next, 0, job);
      this.armDeadline(job);
    }
    this.drain();
  }

  private replenish() {
    const now = Date.now();
    this.tokens = Math.min(
      this.config.startBurst,
      this.tokens +
        (Math.max(0, now - this.tokenAt) * this.config.startsPerSecond) / 1000,
    );
    this.tokenAt = now;
  }

  private schedule(ms: number) {
    if (this.wake) clearTimeout(this.wake);
    this.wake = setTimeout(
      () => {
        this.wake = undefined;
        this.drain();
      },
      Math.max(1, Math.ceil(ms)),
    );
  }

  private drain() {
    this.replenish();
    while (this.active < this.config.globalMaxConcurrent) {
      const normal = this.normalQueue[0];
      const iroh =
        this.activeIroh < this.config.irohMaxConcurrent &&
        this.preparingIroh === 0
          ? this.irohQueue[0]
          : undefined;
      if (normal && normal.deadline <= Date.now()) {
        this.finishNormal(normal, undefined, waitedTooLong());
        continue;
      }
      if (iroh && iroh.deadline <= Date.now()) {
        this.failIroh(iroh, waitedTooLong());
        continue;
      }
      if (!normal && !iroh) return;
      if (
        iroh &&
        !iroh.prepared &&
        (!normal || iroh.sequence < normal.sequence)
      ) {
        this.removeIroh(iroh);
        iroh.state = 'preparing';
        this.preparingIroh++;
        void this.prepareIroh(iroh);
        continue;
      }
      const cooldown = this.cooldownUntil - Date.now();
      if (cooldown > 0) {
        this.schedule(cooldown);
        return;
      }
      if (this.tokens < 1) {
        this.schedule(((1 - this.tokens) * 1000) / this.config.startsPerSecond);
        return;
      }
      this.tokens--;
      if (iroh && (!normal || iroh.sequence < normal.sequence)) {
        this.removeIroh(iroh);
        iroh.state = 'active';
        this.active++;
        this.activeIroh++;
        iroh.resolve({
          signal: iroh.controller.signal,
          release: () => this.releaseIroh(iroh),
          noteRateLimit: (ms) => this.noteRateLimit(ms),
        });
      } else if (normal) {
        this.normalQueue.shift();
        if (normal.timer) clearTimeout(normal.timer);
        normal.state = 'active';
        this.active++;
        void this.executeNormal(normal);
      }
    }
  }

  private async executeNormal<T>(job: NormalJob<T>) {
    let value: T | undefined;
    let error: unknown;
    try {
      job.attempts++;
      value = await job.run(job.controller.signal);
    } catch (caught) {
      error = caught;
    }
    this.active--;
    if (job.controller.signal.aborted || job.state === 'done') {
      this.finishNormal(job, undefined, abortError());
    } else if (!error) {
      this.finishNormal(job, value);
    } else {
      if (error instanceof NansenError && error.status === 429)
        this.noteRateLimit(error.retryAfterMs);
      const retryable =
        error instanceof NansenError &&
        (error.status === 429 || (error.status >= 500 && error.retryable));
      if (retryable && job.attempts <= this.config.jsonMaxRetries) {
        const delay =
          error instanceof NansenError && error.status === 429
            ? Math.max(error.retryAfterMs, 0)
            : this.config.retryBaseDelayMs * (0.75 + Math.random() * 0.5);
        if (Date.now() + delay < job.deadline) {
          job.state = 'backoff';
          job.timer = setTimeout(() => {
            if (job.state !== 'backoff') return;
            if (Date.now() >= job.deadline) {
              this.finishNormal(job, undefined, waitedTooLong());
              return;
            }
            job.state = 'queued';
            job.queuedAt = Date.now();
            job.sequence = this.nextSequence++;
            this.normalQueue.push(job as NormalJob<any>);
            this.armDeadline(job);
            this.drain();
          }, delay);
        } else this.finishNormal(job, undefined, error);
      } else this.finishNormal(job, undefined, error);
    }
    this.drain();
  }
}

export const nansenRequestManager = new NansenRequestManager();
