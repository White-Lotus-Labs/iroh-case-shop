import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coversAny,
  dataUrl,
  declarations,
  matchableSelector,
  pageShotKey,
  paintRefs,
} from '../src/ui/waiting-room/pageSnapshot';

/** A CSSOM rule whose `background` shorthand holds `var()`. */
function fakeStyle(values: Record<string, string>, longhands: string[]) {
  const style: Record<string | number, unknown> = {
    length: longhands.length,
    getPropertyValue: (name: string) => values[name] ?? '',
    getPropertyPriority: () => '',
  };
  longhands.forEach((name, i) => (style[i] = name));
  return style as unknown as CSSStyleDeclaration;
}

describe('pageSnapshot', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keys a shot by page, side and rounded width', () => {
    expect(pageShotKey(3, 'left', 420.4)).toBe('3:left:420');
  });

  it('tests pseudo-element rules against their host element', () => {
    expect(matchableSelector('.sb-page::after')).toBe('.sb-page');
    expect(matchableSelector('.sb-link:hover')).toBe('.sb-link');
    expect(matchableSelector('::selection')).toBe('::selection');
  });

  it('fills var() longhands that CSSOM reads as empty from computed style', () => {
    const style = fakeStyle(
      { content: '""', 'background-size': '280px 280px, auto' },
      ['content', 'background-image', 'background-size'],
    );
    const computed: Record<string, string> = {
      'background-image': 'url("data:tooth"), linear-gradient(red, blue)',
    };
    expect(declarations(style, (name) => computed[name] ?? '')).toBe(
      'content:"";background-image:url("data:tooth"), linear-gradient(red, blue);background-size:280px 280px, auto;',
    );
    expect(declarations(style)).toBe(
      'content:"";background-size:280px 280px, auto;',
    );
  });

  it('keeps a var() shorthand CSSOM still holds, so cqi stays unresolved', () => {
    const style = fakeStyle(
      { font: 'italic max(10px, 2.4cqi) var(--wr-serif)' },
      ['font-style', 'font-size', 'font-family'],
    );
    expect(declarations(style, () => '24px')).toBe(
      'font:italic max(10px, 2.4cqi) var(--wr-serif);',
    );
  });

  it('matches unicode-range descriptors against the text', () => {
    const latin = 'U+0000-00FF, U+0131, U+2000-206F';
    expect(coversAny(latin, [0x41])).toBe(true);
    expect(coversAny(latin, [0x0416])).toBe(false);
    expect(coversAny('U+04??', [0x0416])).toBe(true);
    expect(coversAny('', [0x0416])).toBe(true);
  });

  it('finds each outside paint an svg needs, once', () => {
    expect(
      paintRefs(
        '<rect fill="url(#dock-gold)"/><path stroke="url(#dock-bronze)"/>' +
          '<circle fill="url(#dock-gold)"/>',
      ),
    ).toEqual(['dock-gold', 'dock-bronze']);
    expect(paintRefs('<path fill="#3a2a1d"/>')).toEqual([]);
  });

  it('refuses an error page, and fetches again after a failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    await expect(dataUrl('/fonts/gone.woff2')).rejects.toThrow('404');
    await expect(dataUrl('/fonts/gone.woff2')).rejects.toThrow(
      'Failed to fetch',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
