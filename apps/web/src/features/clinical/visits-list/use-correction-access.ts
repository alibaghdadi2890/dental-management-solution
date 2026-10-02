import { usePermission } from '@/features/auth/use-permission';

/** Which corrections the viewer may make: dentists and owners amend and void; front desk asks a
 * dentist (D14); an assistant (who records visits) gets neither. */
export function useCorrectionAccess(): { amend: boolean; void: boolean; request: boolean } {
  const amend = usePermission('visit:amend');
  const voids = usePermission('visit:void');
  const records = usePermission('visit:write');
  return { amend, void: voids, request: !amend && !voids && !records };
}
