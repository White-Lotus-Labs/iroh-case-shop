import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  normalizeDexTrades,
  normalizeFlowSignal,
  normalizeHolders,
  normalizePerpBook,
  normalizePositionSignal,
  normalizeSupply,
  normalizeTotalHolders,
  normalizeWalletMoves,
} from '../src/thesis/nansen';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/nansen');
const load = (name: string) =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;

describe('thesis nansen normalizers', () => {
  test('maps flow-intelligence smart_trader fields', () => {
    const signal = normalizeFlowSignal(
      'ARB',
      load('tgm-flow-intelligence__ARB.json'),
    );
    expect(signal).toMatchObject({
      symbol: 'ARB',
      status: 'ok',
      source: 'flow-intelligence',
      smartMoneyWallets: 1,
    });
    expect(signal.smartMoneyNetFlowUsd).toBeCloseTo(-118940.16, 0);
    expect(signal.exchangeNetFlowUsd).toBeCloseTo(-9593566.08, 0);
  });

  test('maps position-intelligence net long minus short', () => {
    const signal = normalizePositionSignal(
      'BTC',
      load('tgm-position-intelligence__BTC.json'),
    );
    expect(signal.status).toBe('ok');
    expect(signal.source).toBe('position-intelligence');
    expect(signal.smartMoneyNetFlowUsd).toBeCloseTo(32_572_853.13, 0);
  });

  test('treats a missing flow row as empty', () => {
    expect(normalizeFlowSignal('X', { data: [] }).status).toBe('empty');
    expect(
      normalizeFlowSignal('X', {
        data: [{ smart_trader_net_flow_usd: null }],
      }).status,
    ).toBe('empty');
  });

  test('maps who-bought-sold and dex trades', () => {
    const buyers = normalizeWalletMoves(load('tgm-who-bought-sold__VVV.json'));
    expect(buyers).toHaveLength(2);
    expect(buyers[0]).toMatchObject({
      address: '0xf03c41c8fce656dcf25bfb7d7e9eaf757266020a',
      boughtUsd: expect.any(Number),
    });
    expect(normalizeWalletMoves(load('tgm-who-bought-sold__ARB.json'))).toEqual(
      [],
    );
    const trades = normalizeDexTrades(load('tgm-dex-trades__VVV.json'));
    expect(trades).toHaveLength(5);
    expect(trades[0].action).toBe('sell');
    expect(trades.every((trade) => trade.trader.startsWith('0x'))).toBe(true);
    expect(
      (
        load('tgm-dex-trades__VVV.json') as { data: { action: string }[] }
      ).data.some((row) => row.action === 'BUY'),
    ).toBe(true);
  });

  test('maps holders, supply, and perp book from real samples', () => {
    const holders = normalizeHolders(load('tgm-holders__VVV.json'));
    expect(holders).toHaveLength(5);
    expect(holders[0].ownershipPct).toBeCloseTo(0.022295, 4);
    const info = load('tgm-token-information__VVV.json');
    expect(normalizeTotalHolders(info)).toBe(25633);
    const supply = normalizeSupply(info);
    expect(supply?.circulating).toBeCloseTo(48164886.17, 0);
    expect(supply?.notCirculatingPct).toBeGreaterThan(30);
    const book = normalizePerpBook(
      load('tgm-position-intelligence__BTC.json'),
      load('smart-money-perp-trades__BTC.json'),
    );
    expect(book.smartLongUsd).toBeGreaterThan(50_000_000);
    expect(book.recent).toHaveLength(5);
    expect(book.recent[0].side).toBe('long');
  });

  test('converts balance_change_7d into a percent of prior balance', () => {
    const [normal, newborn, missingAmount] = normalizeHolders({
      data: [
        {
          address: '0x1',
          token_amount: 150,
          balance_change_7d: 50,
        },
        {
          address: '0x2',
          token_amount: 100,
          balance_change_7d: 100,
        },
        {
          address: '0x3',
          balance_change_7d: 25,
        },
      ],
    });
    expect(normal.change7dPct).toBeCloseTo(50);
    expect(newborn.change7dPct).toBeNull();
    expect(missingAmount.change7dPct).toBeNull();
  });
});
