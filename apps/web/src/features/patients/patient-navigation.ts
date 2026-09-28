import { useRouter } from '@tanstack/react-router';
import { type PatientPanel, type PatientPrefill, panelNavigation } from './list-query';

/**
 * Opening a patient or the create panel from outside the list: the shell's "New patient" and the
 * ⌘K palette. It follows the list's own history rules (`panelNavigation`): already on
 * `/patients`, the list keeps its search and an open panel is swapped in place; from another
 * screen it is a plain push. The create pre-fill travels in history state, never in the URL. A
 * dirty create/edit panel's unsaved-changes guard still gets its say.
 */
export function usePatientNavigation() {
  const router = useRouter();

  const openPanel = (panel: PatientPanel, prefill?: PatientPrefill) => {
    const { location } = router.state;
    const onList = location.pathname.replace(/\/$/, '') === '/patients';
    const navigation = panelNavigation(onList ? location : null, panel);
    if (navigation.kind === 'back') return;
    void router.navigate({
      to: '/patients',
      search: navigation.search,
      replace: navigation.replace,
      state: { patientsPanelPushed: navigation.panelPushed, patientPrefill: prefill },
    });
  };

  return {
    openNewPatient: (prefill?: PatientPrefill) => {
      openPanel({ kind: 'new' }, prefill);
    },
    /** A patient picked from the palette. The record route does not exist yet, so this is the
     * list's quick view. */
    openPatient: (patientId: string) => {
      openPanel({ kind: 'quick', id: patientId });
    },
  };
}
