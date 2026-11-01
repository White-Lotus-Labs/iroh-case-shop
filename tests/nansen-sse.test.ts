import { describe, expect, it } from 'vitest';
import { SseDecoder } from '../src/nansen/sse';

describe('Nansen SSE decoder', () => {
  it('keeps split JSON and frames intact, including several events in one chunk', () => {
    const decoder = new SseDecoder();
    expect(decoder.feed('data: {"type":"delta","text":"Hel')).toEqual([]);
    expect(
      decoder.feed('lo"}\n\ndata: {"type":"delta","text":" world"}\n\n'),
    ).toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
    ]);
    expect(
      decoder.feed(
        'data: {"type":"tool_call","name":"holdings"}\r\n\r\ndata: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n\n',
      ),
    ).toEqual([
      { type: 'tool_call', name: 'holdings' },
      { type: 'finish', conversation_id: 'conv_1' },
      { type: 'done' },
    ]);
    expect(() => decoder.end()).not.toThrow();
  });

  it('rejects malformed JSON and interrupted frames', () => {
    expect(() => new SseDecoder().feed('data: {bad}\n\n')).toThrow();
    const decoder = new SseDecoder();
    decoder.feed('data: {"type":"delta"');
    expect(() => decoder.end()).toThrow();
  });

  it('accepts an upstream error event and ignores SSE comments', () => {
    const decoder = new SseDecoder();
    expect(
      decoder.feed(
        ': keepalive\n\ndata: {"type":"error","error":"timeout","status_code":504}\n\n',
      ),
    ).toEqual([{ type: 'error', error: 'timeout', status_code: 504 }]);
  });

  it('accepts a complete DONE sentinel at end of stream without a blank line', () => {
    const decoder = new SseDecoder();
    expect(
      decoder.feed(
        'data: {"type":"finish","conversation_id":"conv_1"}\n\ndata: [DONE]\n',
      ),
    ).toEqual([{ type: 'finish', conversation_id: 'conv_1' }]);
    expect(decoder.end()).toEqual([{ type: 'done' }]);
  });

  it('accepts a successful finish when Nansen returns a null conversation ID', () => {
    const decoder = new SseDecoder();
    expect(
      decoder.feed(
        'data: {"type":"finish","conversation_id":null,"tool_calls":[]}\n\ndata: [DONE]\n\n',
      ),
    ).toEqual([{ type: 'finish', conversation_id: null }, { type: 'done' }]);
  });
});
