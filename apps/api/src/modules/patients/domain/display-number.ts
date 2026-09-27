const DISPLAY_NUMBER_PAD = 6;

/**
 * `P-` + the counter value, zero-padded to at least 6 digits (`P-000001`), growing past 999999
 * without truncation (`P-1234567`). Minted from `patient_counters.last_value` inside the create
 * transaction (CLAUDE.md §7, `PatientCountersRepository.nextValue`). Pure; no I/O.
 */
export function formatDisplayNumber(value: number): string {
  return `P-${String(value).padStart(DISPLAY_NUMBER_PAD, '0')}`;
}
