import type { HistoryState } from '@tanstack/react-router';
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
 * URL search in, navigations out (with the "panel opened from the list" history flag), and the
 * right panel for the `panel` param. The create panel is keyed by its pre-fill too, so a new
 * `?panel=new&fullName=…` starts a fresh form (asking first if the current one is dirty).
 */
export function PatientsScreen({
  search,
  navigate,
}: {
  search: PatientsSearch;
  navigate: (navigation: PatientsNavigation) => void;
}) {
  return (
    <PatientsPage
      search={search}
      onSearch={(next, options) => {
        navigate({
          search: next,
          replace: options?.replace ?? false,
          state: { patientsPanelPushed: options?.panelPushed ?? false },
        });
      }}
      renderPanel={(panel, { close, open }) => (
        <PatientPanel
          key={
            panel.kind === 'new'
              ? JSON.stringify([panelParam(panel), search.fullName, search.phone])
              : panelParam(panel)
          }
          panel={panel}
          prefill={{ fullName: search.fullName, phone: search.phone }}
          onClose={close}
          onOpen={open}
        />
      )}
    />
  );
}
