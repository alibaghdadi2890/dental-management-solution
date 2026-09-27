import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { type ChunkSink, streamChunks } from './stream-chunks';

/** A response double: `write` answers from `accepts`, `destroy()` closes it. */
class FakeResponse extends EventEmitter implements ChunkSink {
  destroyed = false;
  ended = false;
  readonly written: string[] = [];

  constructor(private readonly accepts: (chunk: string) => boolean = () => true) {
    super();
  }

  write(chunk: string): boolean {
    this.written.push(chunk);
    return this.accepts(chunk);
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

/** Chunks `a`, `b`, `c`, counting how many were pulled and whether `return()` was called. */
function source(values = ['a', 'b', 'c']) {
  const pulled: string[] = [];
  let returned = false;
  async function* generate(): AsyncGenerator<string> {
    try {
      for (const value of values) {
        pulled.push(value);
        yield await Promise.resolve(value);
      }
    } finally {
      returned = true;
    }
  }
  return { chunks: generate(), pulled, wasReturned: () => returned };
}

describe('streamChunks', () => {
  it('writes the first chunk and every later one, then ends the response', async () => {
    const response = new FakeResponse();
    const { chunks } = source();
    const first = await chunks.next();

    await expect(streamChunks(response, first, chunks)).resolves.toBe('finished');
    expect(response.written).toEqual(['a', 'b', 'c']);
    expect(response.ended).toBe(true);
  });

  it('waits for drain when the socket buffer is full', async () => {
    const response = new FakeResponse((chunk) => chunk !== 'a');
    const { chunks, pulled } = source();
    const first = await chunks.next();

    const done = streamChunks(response, first, chunks);
    await vi.waitFor(() => {
      expect(response.written).toEqual(['a']);
    });
    expect(pulled).toEqual(['a']);
    response.emit('drain');
    await expect(done).resolves.toBe('finished');
    expect(response.written).toEqual(['a', 'b', 'c']);
  });

  it('stops without pulling another chunk when the client goes away mid-write', async () => {
    const response = new FakeResponse(() => false);
    const { chunks, pulled, wasReturned } = source();
    const first = await chunks.next();

    const done = streamChunks(response, first, chunks);
    await vi.waitFor(() => {
      expect(response.written).toEqual(['a']);
    });
    response.destroy();
    await expect(done).resolves.toBe('aborted');
    expect(pulled).toEqual(['a']);
    expect(response.written).toEqual(['a']);
    expect(response.ended).toBe(false);
    expect(wasReturned()).toBe(true);
  });

  it('writes nothing when the response is already gone', async () => {
    const response = new FakeResponse();
    response.destroy();
    const { chunks } = source();
    const first = await chunks.next();

    await expect(streamChunks(response, first, chunks)).resolves.toBe('aborted');
    expect(response.written).toEqual([]);
  });

  it('ends an empty stream', async () => {
    const response = new FakeResponse();
    const { chunks } = source([]);
    const first = await chunks.next();

    await expect(streamChunks(response, first, chunks)).resolves.toBe('finished');
    expect(response.ended).toBe(true);
  });
});
