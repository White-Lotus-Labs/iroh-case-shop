import { MAX_QUESTION_LENGTH } from '../nansen/limits';
import type {
  Conviction,
  ConvictionLevel,
  DeckSnapshot,
  Thesis,
  ThesisId,
  ThesisSummary,
} from '../thesis/types';

export type DeckState =
  | { status: 'loading' }
  | { status: 'offline'; reason: string }
  | { status: 'ready'; snapshot: DeckSnapshot };

export const LEVEL_LABEL: Record<ConvictionLevel, string> = {
  weak: 'Weak',
  steeping: 'Building',
  strong: 'Strong',
  unknown: 'No signal',
};

export function convictionTitle(level: ConvictionLevel): string {
  return level === 'unknown'
    ? 'No conviction signal'
    : `${LEVEL_LABEL[level]} conviction`;
}

// ponytail: a thesis that mixes flow and position tickers reads as 7-day flow.
// Split the net figure by source if a mixed thesis is ever added.
/**
 * Position signals are open Hyperliquid perps right now; flow signals cover
 * the last 7 days.
 */
export function netLabel(summary: ThesisSummary, short = false): string {
  const open = summary.tickers.every(
    (t) => t.source === 'position-intelligence',
  );
  if (open) return short ? 'net long · now' : 'net long · open perps';
  return short ? 'net · 7d' : 'net · 7 days';
}

/** Tea strength glyphs for the conviction seal: light, steeping, strong. */
export const LEVEL_GLYPH: Record<ConvictionLevel, string> = {
  weak: '淡',
  steeping: '沏',
  strong: '濃',
  unknown: '未',
};

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'time unknown';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'time unknown';
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** The error text a shop API answer carries, or a plain fallback; never raw exception text. */
export async function shopErrorText(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  if (typeof body?.error === 'string') return body.error;
  return response.status === 503
    ? 'Nansen is not configured.'
    : 'Nansen is unavailable right now.';
}

export function accumulatingLine(
  conviction: Conviction,
  total: number,
): string {
  return `${conviction.accumulating} of ${total} accumulating`;
}

/** One line that explains the meter in plain words. */
export function convictionSentence(
  conviction: Conviction,
  total: number,
): string {
  const assets = total === 1 ? 'asset' : 'assets';
  const gap =
    conviction.measured < total ? ` (${conviction.measured} with data)` : '';
  return `Smart money is accumulating ${conviction.accumulating} of ${total} ${assets}${gap}`;
}

export function buildUncleDraft(
  thesis: Thesis,
  summary: ThesisSummary | null,
): string {
  const level = summary?.conviction.level ?? 'unknown';
  const premise =
    level === 'unknown'
      ? `test “${thesis.title}” with Nansen.`
      : `conviction on “${thesis.title}” is ${LEVEL_LABEL[level].toLowerCase()}.`;
  return `Uncle, ${premise} What could disprove it?`.slice(
    0,
    MAX_QUESTION_LENGTH,
  );
}

/** Trades and wallet moves under $10 are dust; unknown values are hidden too. */
export const DUST_USD = 10;
export function isDust(valueUsd: number | null): boolean {
  return valueUsd === null || Math.abs(valueUsd) < DUST_USD;
}

export function thesisLink(origin: string, id: ThesisId): string {
  return `${origin}/?thesis=${id}`;
}

export function shareText(
  thesis: Thesis,
  summary: ThesisSummary | null,
): string {
  const line = summary
    ? `${convictionSentence(summary.conviction, thesis.tickers.length)}.`
    : 'Checking smart-money activity on Nansen.';
  return `Thesis: ${thesis.title}. ${line} Data by @nansen_ai`;
}

export function xIntentUrl(
  thesis: Thesis,
  summary: ThesisSummary | null,
  origin: string,
): string {
  const params = new URLSearchParams({
    text: shareText(thesis, summary),
    url: thesisLink(origin, thesis.id),
  });
  return `https://x.com/intent/post?${params.toString()}`;
}
