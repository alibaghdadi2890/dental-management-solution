import type { BalanceMoney, PatientListItem, PatientListQuery } from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { balancesQuery } from '@/features/billing/billing-api';
import { practitionersQuery, staffQuery } from '@/features/users/users-api';
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
 * - The list and the page's balances keep the previous answer while the next one loads
 *   (`isPlaceholderData`), so paging or switching views doesn't flash a skeleton or "—" balances.
 * - Dentist names come from all staff (`GET /users`, deactivated dentists included) with
 *   `user:read`, else — and while that loads — from the active practitioners.
 */
export function usePatientsListData(
  query: PatientListQuery,
  { canPay, canReadStaff }: { canPay: boolean; canReadStaff: boolean },
) {
  const list = useQuery({ ...patientListQuery(query), placeholderData: keepPreviousData });
  const counts = useQuery(patientCountsQuery());
  const owing = useQuery({ ...owingCountQuery(), enabled: canPay });
  const duplicates = useQuery(duplicatesQuery());
  const practitioners = useQuery(practitionersQuery());
  const staff = useQuery({ ...staffQuery(), enabled: canReadStaff });

  const rows = list.data?.items ?? NO_ROWS;
  const ids = rows.map((row) => row.id);
  const balances = useQuery({
    ...balancesQuery(ids),
    enabled: canPay && ids.length > 0,
    placeholderData: keepPreviousData,
  });

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

  const dentistNames = useMemo(
    () =>
      new Map(
        staff.data?.map((user) => [user.id, user.displayName]) ??
          practitioners.data?.map((p) => [p.userId, p.displayName]) ??
          [],
      ),
    [staff.data, practitioners.data],
  );

  return {
    list,
    rows,
    counts: counts.data,
    owingCount: owing.data?.count,
    practitioners: practitioners.data ?? [],
    dentistNames,
    balanceById,
    twins,
    duplicateCount,
    firstPair,
  };
}
