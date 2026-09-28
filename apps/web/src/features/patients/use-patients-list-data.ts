import type { BalanceMoney, PatientListItem, PatientListQuery } from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { balancesQuery } from '@/features/billing/billing-api';
import { useStaffNames } from '@/features/users/use-staff-names';
import {
  duplicatesQuery,
  owingCountQuery,
  patientCountsQuery,
  patientListQuery,
} from './patients-api';

const NO_ROWS: readonly PatientListItem[] = [];

/**
 * Every read the Patients list makes, and the lookups derived from them. The page (`view=owing`,
 * `sort=balance` already normalised away without `payment:read`) only renders.
 *
 * - The list keeps the previous answer while the next one loads (`isPlaceholderData`), so paging
 *   or switching views doesn't flash a skeleton; its rows are dimmed and inert meanwhile.
 * - Balances are per page of ids, so the previous page's answer is no use for the next one:
 *   `balancesLoading` holds while the rows on screen have no balances yet, and their cells
 *   shimmer instead of reading "—" (which means "no balance").
 * - Dentist names come from `useStaffNames` (all staff with `user:read`, else the practitioners),
 *   keyed by staff profile id (ADR-0020).
 */
export function usePatientsListData(query: PatientListQuery, { canPay }: { canPay: boolean }) {
  const list = useQuery({ ...patientListQuery(query), placeholderData: keepPreviousData });
  const counts = useQuery(patientCountsQuery());
  const owing = useQuery({ ...owingCountQuery(), enabled: canPay });
  const duplicates = useQuery(duplicatesQuery());
  const staff = useStaffNames();

  const rows = list.data?.items ?? NO_ROWS;
  const ids = rows.map((row) => row.id);
  const balances = useQuery({ ...balancesQuery(ids), enabled: canPay && ids.length > 0 });

  const balanceById = useMemo(() => {
    const byId = new Map<string, readonly BalanceMoney[]>();
    for (const entry of balances.data ?? []) byId.set(entry.patientId, entry.balances);
    return byId;
  }, [balances.data]);

  const duplicateGroups = duplicates.data;
  const { twins, duplicateCount, firstPair } = useMemo(() => {
    const byId = new Map<string, PatientListItem>();
    let count = 0;
    for (const { patients } of duplicateGroups ?? []) {
      count += patients.length;
      for (const patient of patients) {
        const twin = patients.find((other) => other.id !== patient.id);
        if (twin) byId.set(patient.id, twin);
      }
    }
    const [a, b] = duplicateGroups?.[0]?.patients ?? [];
    return {
      twins: byId,
      duplicateCount: count,
      firstPair: a && b ? ([a.id, b.id] as const) : undefined,
    };
  }, [duplicateGroups]);

  return {
    list,
    rows,
    counts: counts.data,
    owingCount: owing.data?.count,
    practitioners: staff.practitioners ?? [],
    dentistNames: staff.dentistNames,
    balanceById,
    balancesLoading: balances.isLoading,
    twins,
    duplicateCount,
    firstPair,
  };
}
