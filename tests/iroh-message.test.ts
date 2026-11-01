import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IrohMessage } from '../src/ui/IrohMessage';

const render = (content: string) =>
  renderToStaticMarkup(createElement(IrohMessage, { content }));

describe('IrohMessage', () => {
  it('keeps counting a numbered list split by blank lines', () => {
    const html = render('1. ETH\n\n2. SOL\n\n3. BTC');
    expect(html).toContain('<ol start="1"><li>ETH</li></ol>');
    expect(html).toContain('<ol start="2"><li>SOL</li></ol>');
    expect(html).toContain('<ol start="3"><li>BTC</li></ol>');
  });

  it('links only http(s) URLs', () => {
    const html = render('[ok](https://nansen.ai) [bad](javascript:alert(1))');
    expect(html).toContain('href="https://nansen.ai"');
    expect(html).not.toContain('href="javascript:');
  });
});
