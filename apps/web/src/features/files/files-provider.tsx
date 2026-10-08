import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { FilesContext, type UploadRequest, type ViewerRequest } from './files-context';
import { UploadPanel } from './upload/upload-panel';
import { FileViewer } from './viewer/file-viewer';

/**
 * Mounts the one upload panel and the one viewer (feature 8), opened through `useFiles` from the
 * patient record, the visit workspace and everything in them that shows a file. A new opening
 * remounts: a fresh batch, a fresh view. Uploading needs `file:write`; without it `openUpload`
 * does nothing, so no entry point has to check twice.
 */
export function FilesProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const canWrite = session?.permissions.includes('file:write') ?? false;
  const [upload, setUpload] = useState<{ id: number; request: UploadRequest } | null>(null);
  const [viewer, setViewer] = useState<{ id: number; request: ViewerRequest } | null>(null);

  const openUpload = useCallback(
    (request: UploadRequest) => {
      if (!canWrite) return;
      setUpload((current) => ({ id: (current?.id ?? 0) + 1, request }));
    },
    [canWrite],
  );
  const openViewer = useCallback((request: ViewerRequest) => {
    if (request.ids.length === 0) return;
    setViewer((current) => ({ id: (current?.id ?? 0) + 1, request }));
  }, []);
  const closeUpload = useCallback(() => {
    setUpload(null);
  }, []);
  const closeViewer = useCallback(() => {
    setViewer(null);
  }, []);

  const busy = upload !== null || viewer !== null;
  const actions = useMemo(() => ({ openUpload, openViewer, busy }), [openUpload, openViewer, busy]);

  return (
    <FilesContext.Provider value={actions}>
      {children}
      {upload && session?.tenant && (
        <UploadPanel
          key={upload.id}
          request={upload.request}
          tenant={session.tenant}
          onClose={closeUpload}
          onView={openViewer}
        />
      )}
      {viewer && session?.tenant && (
        <FileViewer
          key={viewer.id}
          request={viewer.request}
          tenant={session.tenant}
          onClose={closeViewer}
        />
      )}
    </FilesContext.Provider>
  );
}
