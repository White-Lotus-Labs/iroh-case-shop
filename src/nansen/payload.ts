/** Small readers for Nansen payloads, shared by the thesis and Shelf loaders. */

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The last `days` days as whole UTC dates, the way the leaderboards take them. */
export function utcDateWindow(now: number, days: number) {
  return {
    from: new Date(now - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}
