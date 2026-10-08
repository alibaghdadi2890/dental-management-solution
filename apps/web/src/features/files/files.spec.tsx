import type { PatientFile, Permission } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import {
  id,
  json,
  patient,
  SESSION_USER_ID,
  sessionWith,
} from '@/features/patients/patients.test-utils';
import { putObject } from './files-api';
import { FilesProvider } from './files-provider';
import { fileFixture } from './files.test-utils';
import { FilesGallery } from './gallery/files-gallery';
import { lastCategory } from './session-memory';
import { UploadPanel } from './upload/upload-panel';
import { FileViewer } from './viewer/file-viewer';

// The bytes go straight to object storage: stubbed here, everything else is the real flow.
vi.mock('./files-api', async (original) => ({
  ...(await original<typeof import('./files-api')>()),
  putObject: vi.fn(() => Promise.resolve()),
}));
// jsdom draws nothing: no previews, as for an image the browser cannot decode.
vi.mock('./previews', () => ({ makePreviews: () => Promise.resolve(null) }));

const PATIENT = patient(1, 'Rami Khoury');
const VISIT = { id: id(40), displayNumber: 71, localDate: '2026-06-10' };
const WRITER: Permission[] = ['patient:read', 'file:read', 'file:write', 'visit:read'];
const fileId = (n: number) => `018f2b1e-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;

const pano = fileFixture({
  id: fileId(1),
  patientId: PATIENT.id,
  category: 'xray',
  subCategory: 'panoramic',
  originalFilename: 'pano.jpg',
  takenAt: '2026-06-10T08:00:27.000Z',
  uploadedBy: SESSION_USER_ID,
  uploadedAt: new Date().toISOString(),
});
const before = fileFixture({
  id: fileId(2),
  patientId: PATIENT.id,
  category: 'photo',
  subCategory: 'before_after',
  toothCode: '36',
  originalFilename: 'before.jpg',
  takenAt: '2026-05-01T08:00:00.000Z',
});
const after = fileFixture({
  id: fileId(3),
  patientId: PATIENT.id,
  category: 'photo',
  subCategory: 'before_after',
  originalFilename: 'after.jpg',
  takenAt: '2026-04-01T08:00:00.000Z',
});
const referral = fileFixture({
  id: fileId(4),
  patientId: PATIENT.id,
  kind: 'document',
  category: 'other',
  mimeType: 'application/pdf',
  originalFilename: 'referral.pdf',
  thumbnailUrl: null,
  takenAt: '2026-03-01T08:00:00.000Z',
});

interface Api {
  calls: { method: string; path: string; body: unknown }[];
  of: (method: string, path: string) => unknown[];
}

function mockApi(files: PatientFile[] = []): Api {
  const calls: Api['calls'] = [];
  let uploads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/v1', '').split('?')[0] ?? '';
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      if (path === '/files/uploads' && method === 'POST') {
        uploads += 1;
        return Promise.resolve(
          json(
            {
              id: fileId(50 + uploads),
              mimeType: 'image/jpeg',
              uploadUrl: 'https://store.test/original',
              displayUploadUrl: null,
              thumbnailUploadUrl: null,
            },
            201,
          ),
        );
      }
      if (path === '/files/uploads' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path === '/files' && method === 'POST') {
        const saved = (body as { files: { id: string; category: PatientFile['category'] }[] })
          .files;
        return Promise.resolve(
          json(
            {
              items: saved.map((item) =>
                fileFixture({ id: item.id, patientId: PATIENT.id, category: item.category }),
              ),
            },
            201,
          ),
        );
      }
      if (path === '/files' && method === 'PATCH') {
        const { ids, patch } = body as { ids: string[]; patch: Partial<PatientFile> };
        return Promise.resolve(
          json({
            items: files
              .filter((file) => ids.includes(file.id))
              .map((file) => ({ ...file, ...patch })),
          }),
        );
      }
      if (path === '/files') return Promise.resolve(json({ items: files }));
      if (path === `/patients/${PATIENT.id}`) return Promise.resolve(json(PATIENT));
      if (path === '/audit') return Promise.resolve(json({ items: [], nextCursor: null }));
      return Promise.resolve(json([]));
    }),
  );
  return {
    calls,
    of: (method, path) =>
      calls.filter((call) => call.method === method && call.path === path).map((call) => call.body),
  };
}

function harness(permissions: Permission[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = sessionWith(permissions);
  queryClient.setQueryData(sessionQueryOptions().queryKey, session);
  if (!session.tenant) throw new Error('session without tenant');
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { tenant: session.tenant, wrap };
}

const image = (name: string) => new File(['bytes'], name, { type: 'image/jpeg' });
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
/** A key pressed in the viewer, wherever focus is inside it. */
const press = (init: { key: string }) =>
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), init);

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(putObject).mockReset();
  vi.mocked(putObject).mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('upload panel (§1)', () => {
  function renderPanel(files: File[], visit: typeof VISIT | null = VISIT) {
    const api = mockApi();
    const { tenant, wrap } = harness(WRITER);
    const onClose = vi.fn();
    const onView = vi.fn();
    render(
      wrap(
        <UploadPanel
          request={{ patientId: PATIENT.id, visit, toothCode: '36', files }}
          tenant={tenant}
          onClose={onClose}
          onView={onView}
        />,
      ),
    );
    return { api, onClose, onView };
  }

  it('saves one dropped image with a single choice: the category', async () => {
    const { api, onClose, onView } = renderPanel([image('pano.jpg')]);
    const panel = await screen.findByRole('dialog', { name: 'Add files' });
    // The context is shown as chips, never hidden (F5).
    expect(within(panel).getByText('Tooth #36')).toBeTruthy();
    expect(within(panel).getByText('Visit V-000071 · 10 Jun 2026')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('No category yet')).toBeTruthy();
    });
    expect(button('Save 1 file').disabled).toBe(true);
    expect(screen.getByText('Choose a category')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'X-ray' }));
    fireEvent.click(button('Panoramic'));
    expect(button('Save 1 file').disabled).toBe(false);
    fireEvent.click(button('Save 1 file'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(api.of('POST', '/files')).toEqual([
      {
        patientId: PATIENT.id,
        files: [
          {
            id: fileId(51),
            category: 'xray',
            subCategory: 'panoramic',
            toothCode: '36',
            visitId: VISIT.id,
            note: '',
            exifTakenAt: null,
          },
        ],
      },
    ]);
    // The next upload of this session starts from the same category (F3).
    expect(lastCategory()).toEqual({ category: 'xray', subCategory: 'panoramic' });
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'View' }));
    expect(onView).toHaveBeenCalledWith({
      patientId: PATIENT.id,
      ids: [fileId(51)],
      startId: fileId(51),
    });
  });

  it('opens on the last category of the session, so a similar upload is drop → Save', async () => {
    sessionStorage.setItem(
      'dcm.files.lastCategory',
      JSON.stringify({ category: 'photo', subCategory: 'intraoral' }),
    );
    renderPanel([image('a.jpg')], null);
    expect(await screen.findByText('Same as last upload — change if needed')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Photo' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => {
      expect(button('Save 1 file').disabled).toBe(false);
    });
    // 1, 2 and 3 choose the category while the header has focus.
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Photo' }), { key: '1' });
    expect(screen.getByRole('radio', { name: 'X-ray' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Same as last upload — change if needed')).toBeNull();
  });

  it('refuses a DICOM file on its tile, retries a failed one, and counts what it will save', async () => {
    vi.mocked(putObject).mockImplementation((_url, body) =>
      body instanceof File && body.name === 'c.jpg'
        ? Promise.reject(new Error('network'))
        : Promise.resolve(),
    );
    renderPanel(
      [image('a.jpg'), image('b.jpg'), image('c.jpg'), new File(['x'], 'scan.dcm')],
      null,
    );
    expect(
      await screen.findByText('DICOM is not supported yet. Export the image as JPEG or PNG.'),
    ).toBeTruthy();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(screen.getByRole('radio', { name: 'Photo' }));
    // One failure blocks nothing: the two that uploaded can be saved.
    expect(button('Save 2 files').disabled).toBe(false);

    vi.mocked(putObject).mockImplementation(() => Promise.resolve());
    fireEvent.click(retry);
    expect(
      (await screen.findByRole<HTMLButtonElement>('button', { name: 'Save 3 files' })).disabled,
    ).toBe(false);

    // "Apply to all", then one tile on its own.
    fireEvent.click(screen.getByRole('button', { name: 'Edit b.jpg' }));
    const tile = screen.getByRole('button', { name: 'Done' }).closest('li');
    if (!tile) throw new Error('no tile');
    fireEvent.click(within(tile).getByRole('radio', { name: 'Other' }));
    expect(within(tile).getByText('Edited')).toBeTruthy();
  });

  it('asks before throwing uploads away, then discards them', async () => {
    const { api, onClose } = renderPanel([image('a.jpg')], null);
    await screen.findByText('No category yet');
    fireEvent.click(button('Cancel'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard 1 file?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(
      api.calls.some((call) => call.method === 'DELETE' && call.path === '/files/uploads'),
    ).toBe(true);
    expect(api.of('POST', '/files')).toEqual([]);
  });
});

describe('viewer (§4)', () => {
  function renderViewer(permissions: Permission[], files = [pano, before, referral]) {
    const api = mockApi(files);
    const { tenant, wrap } = harness(permissions);
    const onClose = vi.fn();
    render(
      wrap(
        <FileViewer
          request={{ patientId: PATIENT.id, ids: files.map((file) => file.id) }}
          tenant={tenant}
          onClose={onClose}
        />,
      ),
    );
    return { api, onClose };
  }

  it('steps through the list it was opened from, wrapping at the ends', async () => {
    renderViewer(WRITER);
    expect(await screen.findByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('X-ray · Panoramic')).toBeTruthy();

    press({ key: 'ArrowLeft' });
    expect(screen.getByText('3 / 3')).toBeTruthy();
    // A document: shown inline, with no image tools.
    expect(screen.getByTitle('Document: referral.pdf')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();

    fireEvent.click(button('Next file'));
    expect(screen.getByText('1 / 3')).toBeTruthy();
    press({ key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByText('Tooth #36')).toBeTruthy();

    press({ key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('rotates for viewing only until Save orientation stores it', async () => {
    const { api } = renderViewer(WRITER);
    await screen.findByText('1 / 3');
    expect(screen.queryByRole('button', { name: 'Save orientation' })).toBeNull();
    fireEvent.click(button('Rotate'));
    press({ key: 'r' });
    expect(api.of('PATCH', '/files')).toEqual([]);
    fireEvent.click(button('Save orientation'));
    await waitFor(() => {
      expect(api.of('PATCH', '/files')).toEqual([{ ids: [pano.id], patch: { orientation: 180 } }]);
    });
    expect(await screen.findByText('Orientation saved')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save orientation' })).toBeNull();
    });
  });

  it('edits details in place with file:write, and only shows them without', async () => {
    const { api } = renderViewer(WRITER);
    await screen.findByText('1 / 3');
    fireEvent.click(button('Details'));
    const details = screen.getByRole('complementary', { name: 'Details' });
    // Passing through "Taken on" changes nothing: the field shows minutes, the time has seconds.
    const taken = within(details).getByLabelText('Taken on');
    fireEvent.focus(taken);
    fireEvent.blur(taken);
    expect(api.of('PATCH', '/files')).toEqual([]);
    const note = within(details).getByLabelText('Note');
    fireEvent.change(note, { target: { value: 'pre-op' } });
    fireEvent.blur(note);
    await waitFor(() => {
      expect(api.of('PATCH', '/files')).toEqual([{ ids: [pano.id], patch: { note: 'pre-op' } }]);
    });
    expect(await within(details).findByText('Saved')).toBeTruthy();
    // The uploader may archive their own upload of today (F13).
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    cleanup();

    renderViewer(['patient:read', 'file:read']);
    await screen.findByText('1 / 3');
    fireEvent.click(button('Rotate'));
    expect(screen.queryByRole('button', { name: 'Save orientation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    fireEvent.click(button('Details'));
    const readOnly = screen.getByRole('complementary', { name: 'Details' });
    expect(within(readOnly).queryByLabelText('Note')).toBeNull();
    expect(within(readOnly).queryByRole('radio', { name: 'X-ray' })).toBeNull();
    expect(within(readOnly).getByText('pano.jpg')).toBeTruthy();
  });
});

describe('gallery (§2)', () => {
  function renderGallery(permissions: Permission[], files = [pano, before, after, referral]) {
    mockApi(files);
    const { tenant, wrap } = harness(permissions);
    // The quick-view link and the viewer's patient lookup need a router around them.
    const rootRoute = createRootRoute({
      component: () => (
        <FilesProvider>
          <FilesGallery patient={PATIENT} tenant={tenant} />
        </FilesProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([
        createRoute({ getParentRoute: () => rootRoute, path: '/' }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(wrap(<RouterProvider router={router} />));
  }

  const tiles = () =>
    screen
      .getAllByRole('button')
      .map((element) => element.getAttribute('aria-label') ?? '')
      // The tiles themselves, not their ⋯ menus.
      .filter((label) => /\.(jpg|pdf)$/.test(label) && !label.startsWith('Actions for'))
      .map((label) => label.split(' · ').at(-1));

  it('filters by category and tooth, and groups by when the files were taken', async () => {
    renderGallery(WRITER);
    await screen.findByRole('region', { name: 'May 2026' });
    expect(tiles()).toEqual(['pano.jpg', 'before.jpg', 'after.jpg', 'referral.pdf']);
    expect(screen.getByRole('region', { name: 'April 2026' })).toBeTruthy();

    const categories = screen.getByRole('group', { name: 'Category' });
    fireEvent.click(within(categories).getByRole('button', { name: 'Photo' }));
    expect(tiles()).toEqual(['before.jpg', 'after.jpg']);
    fireEvent.click(within(categories).getByRole('button', { name: 'Documents' }));
    expect(tiles()).toEqual(['referral.pdf']);

    fireEvent.click(within(categories).getByRole('button', { name: 'All' }));
    const tooth = screen.getByRole('textbox', { name: 'Tooth' });
    fireEvent.change(tooth, { target: { value: '36' } });
    fireEvent.keyDown(tooth, { key: 'Enter' });
    expect(tiles()).toEqual(['before.jpg']);

    fireEvent.click(button('Clear filters'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), {
      target: { value: 'nothing like it' },
    });
    expect(screen.getByText('No files match')).toBeTruthy();
  });

  it('compares exactly two selected images side by side', async () => {
    renderGallery(WRITER);
    await screen.findByRole('region', { name: 'May 2026' });
    fireEvent.click(button('Select'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select before.jpg' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select after.jpg' }));
    fireEvent.click(button('Compare'));

    const compare = await screen.findByRole('dialog', { name: 'Compare' });
    expect(within(compare).getByText('before.jpg')).toBeTruthy();
    expect(within(compare).getByText('after.jpg')).toBeTruthy();
    expect(
      within(compare).getByRole('button', { name: 'Sync zoom' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('shows the gallery but nothing that uploads or edits without file:write', async () => {
    renderGallery(['patient:read', 'file:read']);
    await screen.findByRole('region', { name: 'May 2026' });
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    fireEvent.click(button('Select'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select before.jpg' }));
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set category' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('invites the first upload, three ways, on a patient with no files', async () => {
    renderGallery(WRITER, []);
    expect(await screen.findByText('No files yet')).toBeTruthy();
    expect(
      screen.getByText('Drop X-rays, photos or documents here, click Upload, or paste an image.'),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload' })[0] as HTMLElement);
    expect(await screen.findByRole('dialog', { name: 'Add files' })).toBeTruthy();
  });
});
