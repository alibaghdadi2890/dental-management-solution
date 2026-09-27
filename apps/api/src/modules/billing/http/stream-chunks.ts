/** The part of an HTTP response `streamChunks` uses (Express's `Response` satisfies it). */
export interface ChunkSink {
  readonly destroyed: boolean;
  write(chunk: string): boolean;
  end(): void;
  on(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
}

/**
 * Writes `first` and then every chunk `chunks` still yields to `sink`, one at a time: when the
 * socket buffer is full it waits for `drain` (backpressure), and when the client goes away it
 * stops — without pulling another chunk — and closes the generator. Resolves `'finished'` after
 * `end()`, `'aborted'` when the sink was destroyed.
 *
 * The caller's own loop pulls the chunks rather than a piped `Readable`: stream callbacks run
 * outside the request's async context, where the tenant (CLS) is unknown.
 */
export async function streamChunks(
  sink: ChunkSink,
  first: IteratorResult<string>,
  chunks: AsyncGenerator<string>,
): Promise<'finished' | 'aborted'> {
  for (let next = first; next.done !== true; next = await chunks.next()) {
    if (gone(sink)) break;
    await write(sink, next.value);
    // Checked again before pulling the next chunk: the client may have left during the write.
    if (gone(sink)) break;
  }
  if (gone(sink)) {
    await chunks.return(undefined);
    return 'aborted';
  }
  sink.end();
  return 'finished';
}

/** A function, not an inline check: `destroyed` changes while a write is awaited. */
function gone(sink: ChunkSink): boolean {
  return sink.destroyed;
}

/** Writes one chunk, waiting for the socket to drain (or close) when its buffer is full. */
function write(sink: ChunkSink, chunk: string): Promise<void> {
  if (sink.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      sink.off('drain', done);
      sink.off('close', done);
      resolve();
    };
    sink.on('drain', done);
    sink.on('close', done);
  });
}
