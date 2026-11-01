import { describe, expect, test } from 'vitest';
import { computeConviction } from '../src/thesis/conviction';
import type { TickerSignal } from '../src/thesis/types';

const signal = (
  overrides: Partial<TickerSignal> & Pick<TickerSignal, 'symbol'>,
): TickerSignal => ({
  status: 'ok',
  source: 'flow-intelligence',
  smartMoneyNetFlowUsd: 0,
  whaleNetFlowUsd: null,
  exchangeNetFlowUsd: null,
  smartMoneyWallets: null,
  ...overrides,
});

describe('computeConviction', () => {
  test('returns unknown when nothing is measured', () => {
    expect(computeConviction([])).toEqual({
      level: 'unknown',
      accumulating: 0,
      measured: 0,
      netFlowUsd: null,
    });
    expect(
      computeConviction([
        signal({ symbol: 'A', status: 'empty', smartMoneyNetFlowUsd: null }),
        signal({ symbol: 'B', status: 'error', smartMoneyNetFlowUsd: null }),
      ]),
    ).toMatchObject({ level: 'unknown', measured: 0, netFlowUsd: null });
  });

  test('counts zero net flow as measured but not accumulating', () => {
    const result = computeConviction([
      signal({ symbol: 'A', smartMoneyNetFlowUsd: 0 }),
      signal({ symbol: 'B', smartMoneyNetFlowUsd: -10 }),
    ]);
    expect(result).toEqual({
      level: 'weak',
      accumulating: 0,
      measured: 2,
      netFlowUsd: -10,
    });
  });

  test('maps accumulating ratios to strong, steeping, and weak', () => {
    expect(
      computeConviction([
        signal({ symbol: 'A', smartMoneyNetFlowUsd: 1 }),
        signal({ symbol: 'B', smartMoneyNetFlowUsd: 2 }),
        signal({ symbol: 'C', smartMoneyNetFlowUsd: 3 }),
        signal({ symbol: 'D', smartMoneyNetFlowUsd: -1 }),
      ]),
    ).toMatchObject({ level: 'strong', accumulating: 3, measured: 4 });

    expect(
      computeConviction([
        signal({ symbol: 'A', smartMoneyNetFlowUsd: 1 }),
        signal({ symbol: 'B', smartMoneyNetFlowUsd: 2 }),
        signal({ symbol: 'C', smartMoneyNetFlowUsd: -1 }),
        signal({ symbol: 'D', smartMoneyNetFlowUsd: -2 }),
      ]),
    ).toMatchObject({ level: 'steeping', accumulating: 2, measured: 4 });

    expect(
      computeConviction([
        signal({ symbol: 'A', smartMoneyNetFlowUsd: 1 }),
        signal({ symbol: 'B', smartMoneyNetFlowUsd: -1 }),
        signal({ symbol: 'C', smartMoneyNetFlowUsd: -2 }),
      ]),
    ).toMatchObject({ level: 'weak', accumulating: 1, measured: 3 });
  });

  test('ignores non-finite values and non-ok statuses', () => {
    const result = computeConviction([
      signal({ symbol: 'A', smartMoneyNetFlowUsd: 100 }),
      signal({
        symbol: 'B',
        status: 'ok',
        smartMoneyNetFlowUsd: Number.NaN,
      }),
      signal({
        symbol: 'C',
        status: 'empty',
        smartMoneyNetFlowUsd: 999,
      }),
    ]);
    expect(result).toEqual({
      level: 'strong',
      accumulating: 1,
      measured: 1,
      netFlowUsd: 100,
    });
  });
});
