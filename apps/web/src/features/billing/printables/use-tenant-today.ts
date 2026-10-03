import { useSession } from '@/features/auth/session';
import { todayIn } from '@/lib/format';

/** The tenant's today, `YYYY-MM-DD` (a statement's "as of"). */
export function useTenantToday(): string {
  const { data: session } = useSession();
  return session?.tenant ? todayIn(session.tenant.timeZone) : todayIn('UTC');
}
