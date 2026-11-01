import { nansenPost } from './client';
import { nansenRequestManager } from './request-manager';

function canonical(value: unknown): string {
  // Match the JSON transport's omission of undefined object fields.
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Only the actual HTTP attempt enters the manager; callers' snapshots stay outside. */
export function managedNansenPost<T = unknown>(
  path: string,
  body: unknown,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<T> {
  if (!apiKey.trim()) return nansenPost<T>(path, body, apiKey, fetcher, signal);
  return nansenRequestManager.runNormal(
    `POST:${path}:${canonical(body)}`,
    (sharedSignal) => nansenPost<T>(path, body, apiKey, fetcher, sharedSignal),
    signal,
  );
}
