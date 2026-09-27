import { useSession } from '@/features/auth/session';
import type { PatientPanel as Panel } from '../list-query';
import { MergePanel } from './merge-panel';
import { PatientFormPanel } from './patient-form-panel';
import { QuickViewPanel } from './quick-view-panel';

/**
 * The Patients right panel for the URL's `panel` param (design §Right panel): the quick view, the
 * create/edit form (create pre-filled from the `fullName`/`phone` search params), or the merge
 * compare grid. Keyed by the caller per panel, so swapping panels starts each one afresh.
 */
export function PatientPanel({
  panel,
  prefill,
  onClose,
  onOpen,
}: {
  panel: Panel;
  prefill: { fullName?: string | undefined; phone?: string | undefined };
  onClose: () => void;
  onOpen: (panel: Panel) => void;
}) {
  const { data: session } = useSession();
  const tenant = session?.tenant;
  if (!tenant) return null;

  switch (panel.kind) {
    case 'quick':
      return <QuickViewPanel id={panel.id} tenant={tenant} onClose={onClose} onOpen={onOpen} />;
    case 'new':
      return (
        <PatientFormPanel
          mode={{ kind: 'new', prefill }}
          tenant={tenant}
          onClose={onClose}
          onOpen={onOpen}
        />
      );
    case 'edit':
      return (
        <PatientFormPanel
          mode={{ kind: 'edit', id: panel.id }}
          tenant={tenant}
          onClose={onClose}
          onOpen={onOpen}
        />
      );
    case 'merge':
      return <MergePanel ids={panel.ids} tenant={tenant} onClose={onClose} onOpen={onOpen} />;
  }
}
