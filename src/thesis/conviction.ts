import type { Conviction, TickerSignal } from './types';

export function computeConviction(signals: TickerSignal[]): Conviction {
  const measuredSignals = signals.filter(
    (signal) =>
      signal.status === 'ok' &&
      typeof signal.smartMoneyNetFlowUsd === 'number' &&
      Number.isFinite(signal.smartMoneyNetFlowUsd),
  );
  const measured = measuredSignals.length;
  const accumulating = measuredSignals.filter(
    (signal) => (signal.smartMoneyNetFlowUsd as number) > 0,
  ).length;
  const netFlowUsd =
    measured === 0
      ? null
      : measuredSignals.reduce(
          (sum, signal) => sum + (signal.smartMoneyNetFlowUsd as number),
          0,
        );
  const ratio = measured === 0 ? 0 : accumulating / measured;
  const level =
    measured === 0
      ? 'unknown'
      : ratio >= 0.75
        ? 'strong'
        : ratio >= 0.5
          ? 'steeping'
          : 'weak';
  return { level, accumulating, measured, netFlowUsd };
}
