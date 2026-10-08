import type { ToothCode } from '@dcm/contracts';
import { createContext, useContext } from 'react';
import type { VisitOption } from './visit-options';

/** What opens the upload panel (feature 8, F5, F6): the patient, and what the context knows. */
export interface UploadRequest {
  patientId: string;
  /** Pre-filled from a visit: the workspace, its tooth panel, its summary. */
  visit?: VisitOption | null | undefined;
  /** Pre-filled from a tooth panel. */
  toothCode?: ToothCode | null | undefined;
  /** Dropped or pasted files; without them the panel opens on its drop zone. */
  files?: readonly File[] | undefined;
}

/** What opens the viewer: the list it navigates is the list it was opened from (§4). */
export interface ViewerRequest {
  patientId: string;
  /** The files to step through, in order. */
  ids: readonly string[];
  /** Where to start; the first file otherwise. */
  startId?: string | undefined;
  /** Side by side instead (the gallery's Compare): exactly two images. */
  compare?: boolean | undefined;
  /** Open with the details panel showing (the tile menu's "Edit details"). */
  details?: boolean | undefined;
}

export interface FilesActions {
  openUpload: (request: UploadRequest) => void;
  openViewer: (request: ViewerRequest) => void;
  /** The panel or the viewer is open: the page's own drop and paste stand aside. */
  busy: boolean;
}

export const FilesContext = createContext<FilesActions | null>(null);

const NOWHERE: FilesActions = {
  openUpload: () => undefined,
  openViewer: () => undefined,
  busy: false,
};

/**
 * The upload panel and the viewer, mounted once in the app shell (`FilesProvider`) and opened
 * from wherever files show. Outside the shell (a printable) the actions do nothing.
 */
export function useFiles(): FilesActions {
  return useContext(FilesContext) ?? NOWHERE;
}
