import { type HistoryState, useLocation } from '@tanstack/react-router';
import { type PatientsSearch, panelParam } from './list-query';
import { PatientPanel } from './panels/patient-panel';
import { PatientsPage } from './patients-page';

export interface PatientsNavigation {
  search: PatientsSearch;
  replace: boolean;
  state: HistoryState;
}

/**
 * The `/patients` route's wiring, shared with the tests so they drive exactly what ships: the
 * URL search in, navigations out (with the "panel opened from the list" history flag and the
 * create pre-fill, both history state), and the right panel for the `panel` param. The create
 * panel is keyed by its pre-fill too, so a new pre-fill starts a fresh form (asking first if the
 * current one is dirty). A `?panel=new` reached without one — a link, a bookmark — is empty.
 */
export function PatientsScreen({
  search,
  navigate,
}: {
  search: PatientsSearch;
  navigate: (navigation: PatientsNavigation) => void;
}) {
  const prefill = useLocation({ select: (location) => location.state.patientPrefill });
  return (
    <PatientsPage
      search={search}
      onSearch={(next, options) => {
        navigate({
          search: next,
          replace: options?.replace ?? false,
          state: {
            patientsPanelPushed: options?.panelPushed ?? false,
            patientPrefill: options?.prefill,
          },
        });
      }}
      renderPanel={(panel, { close, open }) => (
        <PatientPanel
          key={
            panel.kind === 'new'
              ? JSON.stringify([panelParam(panel), prefill?.fullName, prefill?.phone])
              : panelParam(panel)
          }
          panel={panel}
          prefill={prefill ?? {}}
          onClose={close}
          onOpen={open}
        />
      )}
    />
  );
}
