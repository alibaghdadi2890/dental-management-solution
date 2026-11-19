import type { BalanceState, Money, Session, UpcomingAppointment } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { balancesQuery, balanceStatesQuery } from '@/features/billing/billing-api';
import { upcomingQuery } from '@/features/scheduling/scheduling-api';

/** What a patient row shows beside the name (search S10); `undefined` while it loads. */
export interface PatientDetails {
  /** Null with no appointment ahead, or without `appointment:read`. */
  next: UpcomingAppointment | null | undefined;
  /** Null when settled, or without a money permission. The amount is null without `finance:read`. */
  balance:
    { state: Exclude<BalanceState['state'], 'settled'>; money: Money | null } | null | undefined;
}

/**
 * The patients' next appointment and balance, asked once the rows are known (S9): typing never
 * waits for them, and a failed lookup leaves its part empty. The balance's amount needs
 * `finance:read` (balances in a list, ADR-0055); `payment:read` alone gives the state.
 */
export function usePatientDetails(
  session: Session,
  ids: readonly string[],
): (id: string) => PatientDetails {
  const can = (permission: Session['permissions'][number]) =>
    session.permissions.includes(permission);
  const seesNext = can('appointment:read');
  const seesAmounts = can('finance:read');
  const seesStates = !seesAmounts && can('payment:read');
  const upcoming = useQuery({ ...upcomingQuery(ids), enabled: seesNext && ids.length > 0 });
  const amounts = useQuery({ ...balancesQuery(ids), enabled: seesAmounts && ids.length > 0 });
  const states = useQuery({ ...balanceStatesQuery(ids), enabled: seesStates && ids.length > 0 });

  const nextOf = (id: string): PatientDetails['next'] => {
    if (!seesNext || upcoming.isError) return null;
    return upcoming.data ? (upcoming.data.find((row) => row.patientId === id) ?? null) : undefined;
  };
  const balanceOf = (id: string): PatientDetails['balance'] => {
    if (seesAmounts) {
      if (amounts.isError) return null;
      if (!amounts.data) return undefined;
      const sums = amounts.data.find((row) => row.patientId === id)?.balances ?? [];
      const owing = sums.find((sum) => !sum.amount.startsWith('-') && /[1-9]/.test(sum.amount));
      if (owing) return { state: 'owes', money: owing };
      const credit = sums.find((sum) => sum.amount.startsWith('-') && /[1-9]/.test(sum.amount));
      return credit
        ? { state: 'credit', money: { ...credit, amount: credit.amount.slice(1) } }
        : null;
    }
    if (!seesStates || states.isError) return null;
    if (!states.data) return undefined;
    const state = states.data.find((row) => row.patientId === id)?.state ?? 'settled';
    return state === 'settled' ? null : { state, money: null };
  };
  return (id) => ({ next: nextOf(id), balance: balanceOf(id) });
}
