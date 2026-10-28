import { usePermission } from '@/features/auth/use-permission';

/** Which corrections the viewer may make: dentists and owners correct ("amend") and void, and
 * set prices in a correction with `visit:discount` (ADR-0055, ADR-0062); front desk asks a dentist
 * (D14); an assistant (who records visits) gets neither. */
export function useCorrectionAccess(): {
  amend: boolean;
  void: boolean;
  price: boolean;
  request: boolean;
} {
  const amend = usePermission('visit:amend');
  const voids = usePermission('visit:void');
  const price = usePermission('visit:discount');
  const records = usePermission('visit:write');
  return { amend, void: voids, price, request: !amend && !voids && !records };
}
