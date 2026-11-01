import { describe, expect, it } from 'vitest';
import { convictionToMood } from '../src/ui/convictionMood';

describe('convictionToMood', () => {
  it('maps conviction levels to scene moods', () => {
    expect(convictionToMood('strong')).toBe('supported');
    expect(convictionToMood('steeping')).toBe('mixed');
    expect(convictionToMood('weak')).toBe('challenged');
    expect(convictionToMood('unknown')).toBe('unknown');
    expect(convictionToMood(null)).toBe('unknown');
    expect(convictionToMood(undefined)).toBe('unknown');
  });
});
