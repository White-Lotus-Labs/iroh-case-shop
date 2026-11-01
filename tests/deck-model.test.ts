import { describe, expect, it } from 'vitest';
import { MAX_QUESTION_LENGTH } from '../src/nansen/limits';
import { findThesis, THESES } from '../src/thesis/deck';
import { DECK_FIXTURE } from '../src/thesis/fixtures';
import {
  buildUncleDraft,
  convictionSentence,
  formatRelative,
  isDust,
  xIntentUrl,
} from '../src/ui/deckModel';
import {
  readBackgroundMusic,
  writeBackgroundMusic,
} from '../src/ui/backgroundMusic';

const ai = findThesis('ai')!;
const aiSummary = DECK_FIXTURE.theses.find((t) => t.id === 'ai')!;

describe('deck model', () => {
  it('formats relative time', () => {
    const now = Date.parse('2026-09-27T06:10:00.000Z');
    expect(formatRelative('2026-09-27T06:09:50.000Z', now)).toBe('just now');
    expect(formatRelative('2026-09-27T06:00:00.000Z', now)).toBe('10 min ago');
    expect(formatRelative('2026-09-27T03:10:00.000Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-09-25T06:10:00.000Z', now)).toBe('2 d ago');
    expect(formatRelative(null, now)).toBe('time unknown');
  });

  it('explains conviction and flags missing data', () => {
    expect(convictionSentence(aiSummary.conviction, 4)).toBe(
      'Smart money is accumulating 1 of 4 assets (3 with data)',
    );
  });

  it('builds concise Uncle drafts within the chat limit', () => {
    const draft = buildUncleDraft(ai, aiSummary);
    expect(draft).toBe(
      'Uncle, conviction on “AI Taking Over the World” is weak. What could disprove it?',
    );
    expect(buildUncleDraft(ai, null)).toBe(
      'Uncle, test “AI Taking Over the World” with Nansen. What could disprove it?',
    );
    for (const thesis of THESES) {
      const summary = DECK_FIXTURE.theses.find(
        (item) => item.id === thesis.id,
      )!;
      expect(buildUncleDraft(thesis, summary).length).toBeLessThanOrEqual(
        MAX_QUESTION_LENGTH,
      );
      expect(buildUncleDraft(thesis, null).length).toBeLessThanOrEqual(
        MAX_QUESTION_LENGTH,
      );
    }
  });

  it('builds an X intent with the deep link and @nansen_ai', () => {
    const url = new URL(xIntentUrl(ai, aiSummary, 'https://tea.example'));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('url')).toBe('https://tea.example/?thesis=ai');
    expect(url.searchParams.get('text')).toContain('@nansen_ai');
    expect(url.searchParams.get('text')).toContain('1 of 4 assets');
  });

  it('treats small or unknown amounts as dust', () => {
    expect(isDust(0)).toBe(true);
    expect(isDust(4)).toBe(true);
    expect(isDust(null)).toBe(true);
    expect(isDust(10)).toBe(false);
    expect(isDust(-64_000)).toBe(false);
  });

  it('handles background music when the browser blocks site data', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      expect(readBackgroundMusic()).toBe(true);
      expect(() => writeBackgroundMusic(false)).not.toThrow();
    } finally {
      if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
