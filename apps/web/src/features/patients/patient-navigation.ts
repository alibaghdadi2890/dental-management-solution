import { useRouter } from '@tanstack/react-router';
import { type PatientPanel, type PatientPrefill, panelNavigation } from './list-query';

/**
 * Opening a patient, or a Patients panel from outside the list: the shell's "New patient", the ⌘K
 * palette, the list's rows and the patient record. A panel follows the list's own history rules
 * (`panelNavigation`): already on `/patients`, the list keeps its search and an open panel is
 * swapped in place; from another screen it is a plain push. The create pre-fill travels in
 * history state, never in the URL. A dirty create/edit panel's (or record form's) unsaved-changes
 * guard still gets its say.
 */
export function usePatientNavigation() {
  const router = useRouter();

  const openPanel = (
    panel: PatientPanel,
    { prefill, returnOnClose = false }: { prefill?: PatientPrefill; returnOnClose?: boolean } = {},
  ) => {
    const { location } = router.state;
    const onList = location.pathname.replace(/\/$/, '') === '/patients';
    const navigation = panelNavigation(onList ? location : null, panel);
    if (navigation.kind === 'back') return;
    void router.navigate({
      to: '/patients',
      search: navigation.search,
      replace: navigation.replace,
      state: {
        patientsPanelPushed: navigation.panelPushed || (!onList && returnOnClose),
        patientPrefill: prefill,
      },
    });
  };

  return {
    openNewPatient: (prefill?: PatientPrefill) => {
      openPanel({ kind: 'new' }, { prefill });
    },
    /** The patient record (`/patients/$patientId`); `startVisit` opens its start popover. */
    openPatient: (patientId: string, { startVisit = false }: { startVisit?: boolean } = {}) => {
      void router.navigate({
        to: '/patients/$patientId',
        params: { patientId },
        ...(startVisit ? { search: { startVisit: true as const } } : {}),
      });
    },
    /** The record's "Edit patient": the Patients edit panel over the list (README "Patient record
     * + visit workspace"). Its entry is marked as pushed, so closing the panel — or saving it —
     * goes back to the record it was opened from. */
    editPatient: (patientId: string) => {
      openPanel({ kind: 'edit', id: patientId }, { returnOnClose: true });
    },
  };
}
