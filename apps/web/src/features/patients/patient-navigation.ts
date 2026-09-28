import { useRouter } from '@tanstack/react-router';
import {
  listQueryOf,
  type PatientPanel,
  panelParam,
  parsePanel,
  parsePatientsSearch,
} from './list-query';

/** What the create panel starts with (design "digits → phone, otherwise name"). */
export interface NewPatientPrefill {
  fullName?: string;
  phone?: string;
}

/**
 * Opening a patient or the create panel from outside the list: the shell's "New patient" and the
 * ⌘K palette. Already on `/patients`, the list keeps its search and the panel follows the list's
 * own history rules (`PatientsPage`'s `openPanel`): an open panel is swapped in place, otherwise
 * the new entry is marked as pushed so closing the panel goes back. From another screen it is a
 * plain navigation. A dirty create/edit panel's unsaved-changes guard still gets its say.
 */
export function usePatientNavigation() {
  const router = useRouter();

  const openPanel = (panel: PatientPanel, prefill: NewPatientPrefill = {}) => {
    const { location } = router.state;
    const onList = location.pathname.replace(/\/$/, '') === '/patients';
    const current = onList ? parsePatientsSearch(location.search) : undefined;
    const open = parsePanel(current?.panel) !== null;
    const pushed = open && location.state.patientsPanelPushed === true;
    void router.navigate({
      to: '/patients',
      search: { ...(current ? listQueryOf(current) : {}), panel: panelParam(panel), ...prefill },
      replace: open,
      state: { patientsPanelPushed: onList && (!open || pushed) },
    });
  };

  return {
    openNewPatient: (prefill?: NewPatientPrefill) => {
      openPanel({ kind: 'new' }, prefill);
    },
    /** A patient picked from the palette. The record route does not exist yet, so this is the
     * list's quick view. */
    openPatient: (patientId: string) => {
      openPanel({ kind: 'quick', id: patientId });
    },
  };
}
