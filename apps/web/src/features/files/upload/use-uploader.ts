import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { exifOf } from '../exif';
import { discardUploads, putObject, requestUpload } from '../files-api';
import { makePreviews } from '../previews';
import {
  type Batch,
  type BatchAction,
  batchReducer,
  type FileMeta,
  type Tile,
} from './upload-batch';

/** How many files upload at once; the rest wait their turn. */
const CONCURRENCY = 3;

/** Runs at most `limit` tasks at a time, in the order they were pushed. */
class UploadQueue {
  private readonly waiting: (() => Promise<void>)[] = [];
  private running = 0;

  constructor(private readonly limit: number) {}

  push(task: () => Promise<void>): void {
    this.waiting.push(task);
    this.pump();
  }

  /** Forgets what has not started. */
  clear(): void {
    this.waiting.length = 0;
  }

  private pump(): void {
    while (this.running < this.limit) {
      const next = this.waiting.shift();
      if (!next) return;
      this.running += 1;
      void next().finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }
}
const PREVIEW_TYPE = 'image/jpeg';

/**
 * The upload panel's batch and the uploads behind it (feature 8, F2): bytes start uploading the
 * moment a file is added — its previews made first, in the browser — each tile on its own, so
 * one failure never holds the others back. Removing a tile, retrying one, or closing the panel
 * aborts what is in flight and discards what the server already holds.
 */
export function useUploader(patientId: string, initial: Batch) {
  const [batch, dispatchState] = useReducer(batchReducer, initial);
  // The reducer's state as of the last action, for the callbacks that read it between renders.
  const latest = useRef(batch);
  const controllers = useRef(new Map<string, AbortController>());
  const previewUrls = useRef(new Set<string>());
  const [queue] = useState(() => new UploadQueue(CONCURRENCY));

  const dispatch = useCallback((action: BatchAction) => {
    latest.current = batchReducer(latest.current, action);
    dispatchState(action);
  }, []);

  const upload = useCallback(
    async (tile: Pick<Tile, 'key' | 'file' | 'kind' | 'mimeType'>) => {
      const { key, file } = tile;
      // Removed while it waited its turn: nothing to upload, nothing to leave behind.
      const waiting = latest.current.tiles.find((candidate) => candidate.key === key);
      if (waiting?.status !== 'uploading') return;
      const controller = new AbortController();
      controllers.current.set(key, controller);
      const { signal } = controller;
      // Read through a function: the signal changes under the awaits below.
      const aborted = () => signal.aborted;
      let uploadId: string | null = null;
      try {
        const [exif, previews] =
          tile.kind === 'image'
            ? await Promise.all([exifOf(file, tile.mimeType), makePreviews(file, tile.mimeType)])
            : [null, null];
        if (aborted()) return;
        let previewUrl: string | null = null;
        if (previews) {
          previewUrl = URL.createObjectURL(previews.thumbnail);
          previewUrls.current.add(previewUrl);
        }
        dispatch({ type: 'prepared', key, previewUrl, exifTakenAt: exif?.takenAt ?? null });

        const target = await requestUpload({
          patientId,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          preview: previews !== null,
        });
        uploadId = target.id;
        if (aborted()) throw new DOMException('Upload aborted', 'AbortError');
        dispatch({ type: 'started', key, uploadId });
        await Promise.all([
          putObject(target.uploadUrl, file, target.mimeType, {
            signal,
            onProgress: (progress) => {
              dispatch({ type: 'progress', key, progress });
            },
          }),
          previews && target.displayUploadUrl
            ? putObject(target.displayUploadUrl, previews.display, PREVIEW_TYPE, { signal })
            : null,
          previews && target.thumbnailUploadUrl
            ? putObject(target.thumbnailUploadUrl, previews.thumbnail, PREVIEW_TYPE, { signal })
            : null,
        ]);
        dispatch({ type: 'uploaded', key });
      } catch {
        // A failed or abandoned upload leaves nothing behind on the server.
        if (uploadId !== null) void discardUploads([uploadId]).catch(() => undefined);
        if (!aborted()) {
          controller.abort();
          dispatch({ type: 'failed', key });
        }
      } finally {
        controllers.current.delete(key);
      }
    },
    [patientId, dispatch],
  );

  const enqueue = useCallback(
    (tiles: readonly Tile[]) => {
      for (const tile of tiles) queue.push(() => upload(tile));
    },
    [upload, queue],
  );

  const add = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const keyed = files.map((file) => ({ key: crypto.randomUUID(), file }));
      dispatch({ type: 'add', files: keyed });
      const keys = new Set<string>(keyed.map((entry) => entry.key));
      enqueue(
        latest.current.tiles.filter((tile) => keys.has(tile.key) && tile.status === 'uploading'),
      );
    },
    [dispatch, enqueue],
  );

  const retry = useCallback(
    (key: string) => {
      dispatch({ type: 'retry', key });
      enqueue(latest.current.tiles.filter((tile) => tile.key === key));
    },
    [dispatch, enqueue],
  );

  const remove = useCallback(
    (key: string) => {
      const tile = latest.current.tiles.find((candidate) => candidate.key === key);
      controllers.current.get(key)?.abort();
      // In flight, the upload's own cleanup discards it; once uploaded, this does.
      if (tile?.status === 'uploaded' && tile.uploadId !== null) {
        void discardUploads([tile.uploadId]).catch(() => undefined);
      }
      dispatch({ type: 'remove', key });
    },
    [dispatch],
  );

  /** Closing without saving: nothing uploaded is kept. */
  const discardAll = useCallback(() => {
    queue.clear();
    for (const controller of controllers.current.values()) controller.abort();
    const ids = latest.current.tiles.flatMap((tile) =>
      tile.status === 'uploaded' && tile.uploadId !== null ? [tile.uploadId] : [],
    );
    if (ids.length > 0) void discardUploads(ids).catch(() => undefined);
  }, [queue]);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  return {
    batch,
    add,
    retry,
    remove,
    discardAll,
    setHeader: useCallback(
      (patch: Partial<FileMeta>) => {
        dispatch({ type: 'header', patch });
      },
      [dispatch],
    ),
    setTile: useCallback(
      (key: string, patch: Partial<FileMeta>) => {
        dispatch({ type: 'tile', key, patch });
      },
      [dispatch],
    ),
  };
}
