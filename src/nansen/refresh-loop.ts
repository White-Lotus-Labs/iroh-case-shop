import { db } from '../auth/db';
import { refreshSavedNansenData } from './refresh';
import { NANSEN_REFRESH_MS } from './snapshot-store';

const globalForRefresh = globalThis as { nansenHourlyRefresh?: boolean };

/** Never wake sooner than this, so a clock jump cannot spin the loop. */
const MIN_WAIT_MS = 60 * 1000;

function logReport(
  report: Awaited<ReturnType<typeof refreshSavedNansenData>>,
): void {
  if (report.skipped === 'no-key') {
    console.info('Nansen refresh skipped: API key is not set.');
    return;
  }
  console.info(
    `Nansen refresh saved ${report.saved.length}, kept ${report.kept.length}, missing ${report.missing.length}, still fresh ${report.fresh.length}.`,
  );
}

/**
 * Fill SQLite now, then run again when the next saved row falls due (at most
 * an hour later). Waking on the rows, not on the process start, keeps a
 * restart from leaving readings stale. One loop per process.
 */
export function startHourlyNansenRefresh(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (globalForRefresh.nansenHourlyRefresh) return;
  globalForRefresh.nansenHourlyRefresh = true;

  const run = () => {
    void refreshSavedNansenData(db)
      .then((report) => {
        logReport(report);
        return report.nextDueAt;
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Refresh failed';
        console.error(`Nansen refresh failed: ${message}`);
        return Date.now() + NANSEN_REFRESH_MS;
      })
      .then((nextDueAt) => {
        const wait = Math.min(
          Math.max(nextDueAt - Date.now(), MIN_WAIT_MS),
          NANSEN_REFRESH_MS,
        );
        setTimeout(run, wait);
      });
  };
  run();
}
