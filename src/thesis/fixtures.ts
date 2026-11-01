import type { DeckSnapshot, TickerDetail } from './types';

// Realistic mock payloads for UI work and browser tests. Not live data.

export const DECK_FIXTURE: DeckSnapshot = {
  fetchedAt: '2026-09-27T06:00:00.000Z',
  expiresAt: '2026-09-27T06:10:00.000Z',
  source: 'nansen',
  stale: false,
  theses: [
    {
      id: 'robinhood',
      conviction: {
        level: 'steeping',
        accumulating: 2,
        measured: 3,
        netFlowUsd: 412_300,
      },
      tickers: [
        {
          symbol: 'NET',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: 184_200,
          whaleNetFlowUsd: 52_000,
          exchangeNetFlowUsd: -12_400,
          smartMoneyWallets: 9,
        },
        {
          symbol: 'SHROOM',
          status: 'empty',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: null,
          whaleNetFlowUsd: null,
          exchangeNetFlowUsd: null,
          smartMoneyWallets: null,
        },
        {
          symbol: 'ARB',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: 611_900,
          whaleNetFlowUsd: -1_204_000,
          exchangeNetFlowUsd: 330_000,
          smartMoneyWallets: 41,
        },
        {
          symbol: 'UNI',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: -383_800,
          whaleNetFlowUsd: 90_500,
          exchangeNetFlowUsd: -48_000,
          smartMoneyWallets: 27,
        },
      ],
    },
    {
      id: 'bullrun',
      conviction: {
        level: 'strong',
        accumulating: 4,
        measured: 4,
        netFlowUsd: 48_900_000,
      },
      tickers: [
        {
          symbol: 'BTC',
          status: 'ok',
          source: 'position-intelligence',
          smartMoneyNetFlowUsd: 31_200_000,
          whaleNetFlowUsd: null,
          exchangeNetFlowUsd: null,
          smartMoneyWallets: 212,
        },
        {
          symbol: 'ETH',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: 12_600_000,
          whaleNetFlowUsd: 8_100_000,
          exchangeNetFlowUsd: -22_000_000,
          smartMoneyWallets: 188,
        },
        {
          symbol: 'HYPE',
          status: 'ok',
          source: 'position-intelligence',
          smartMoneyNetFlowUsd: 3_900_000,
          whaleNetFlowUsd: null,
          exchangeNetFlowUsd: null,
          smartMoneyWallets: 96,
        },
        {
          symbol: 'SOL',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: 1_200_000,
          whaleNetFlowUsd: 640_000,
          exchangeNetFlowUsd: -2_800_000,
          smartMoneyWallets: 73,
        },
      ],
    },
    {
      id: 'ai',
      conviction: {
        level: 'weak',
        accumulating: 1,
        measured: 3,
        netFlowUsd: -95_400,
      },
      tickers: [
        {
          symbol: 'VVV',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: 74_600,
          whaleNetFlowUsd: 12_000,
          exchangeNetFlowUsd: -3_100,
          smartMoneyWallets: 14,
        },
        {
          symbol: 'SNDK',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: -41_000,
          whaleNetFlowUsd: null,
          exchangeNetFlowUsd: null,
          smartMoneyWallets: 3,
        },
        {
          symbol: 'NVDA',
          status: 'ok',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: -129_000,
          whaleNetFlowUsd: 20_000,
          exchangeNetFlowUsd: null,
          smartMoneyWallets: 6,
        },
        {
          symbol: 'MU',
          status: 'error',
          source: 'flow-intelligence',
          smartMoneyNetFlowUsd: null,
          whaleNetFlowUsd: null,
          exchangeNetFlowUsd: null,
          smartMoneyWallets: null,
        },
      ],
    },
  ],
};

export const TICKER_DETAIL_FIXTURE: TickerDetail = {
  thesisId: 'ai',
  symbol: 'NVDA',
  fetchedAt: '2026-09-27T06:02:00.000Z',
  stale: false,
  movements: {
    status: 'ok',
    data: {
      buyers: [
        {
          address: '0x3f5c9e2a1b7d4c6e8f0a2b4c6d8e0f1a2b3c4d5e',
          label: 'Smart Trader',
          boughtUsd: 88_400,
          soldUsd: 0,
        },
        {
          address: '0x9a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
          label: 'Fund',
          boughtUsd: 41_000,
          soldUsd: 5_200,
        },
      ],
      sellers: [
        {
          address: '0x7e6d5c4b3a291807f6e5d4c3b2a19087f6e5d4c3',
          label: '30D Smart Trader',
          boughtUsd: 0,
          soldUsd: 212_000,
        },
      ],
      recent: [
        {
          trader: '0x3f5c9e2a1b7d4c6e8f0a2b4c6d8e0f1a2b3c4d5e',
          label: 'Smart Trader',
          action: 'buy',
          valueUsd: 22_100,
          at: '2026-09-27T04:41:00.000Z',
          txHash:
            '0xabc1230000000000000000000000000000000000000000000000000000000001',
        },
        {
          trader: '0x7e6d5c4b3a291807f6e5d4c3b2a19087f6e5d4c3',
          label: '30D Smart Trader',
          action: 'sell',
          valueUsd: 64_000,
          at: '2026-09-27T02:15:00.000Z',
          txHash:
            '0xabc1230000000000000000000000000000000000000000000000000000000002',
        },
      ],
    },
  },
  holders: {
    status: 'ok',
    data: {
      totalHolders: 4_812,
      smartMoney: [
        {
          address: '0x9a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
          label: 'Fund',
          valueUsd: 1_420_000,
          ownershipPct: 3.1,
          change7dPct: 12.4,
        },
        {
          address: '0x3f5c9e2a1b7d4c6e8f0a2b4c6d8e0f1a2b3c4d5e',
          label: 'Smart Trader',
          valueUsd: 610_000,
          ownershipPct: 1.3,
          change7dPct: 40.2,
        },
      ],
    },
  },
  supply: { status: 'not-applicable' },
  perps: { status: 'not-applicable' },
};
