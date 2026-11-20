import { canWriteWaitlistEntry } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate } from '@/lib/format';
import { invalidateSchedule } from '../scheduling-api';
import { patientWaitlistQuery, removeWaitlistEntry, waitingWithout } from './waitlist-api';

/**
 * A booking's quiet line (A5): the patient waits with no appointment. Booked some other way, they
 * stay listed unless *Remove* is pressed; a booking that takes the entry's follow-up fills it, so
 * the line says nothing then.
 */
export function OnTheWaitlistLine({
  patientId,
  followUpId,
}: {
  patientId: string | undefined;
  followUpId?: string | undefined;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const entry = useQuery({
    ...patientWaitlistQuery(patientId ?? '', patientId !== undefined),
    select: waitingWithout,
  });
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (id: string) => removeWaitlistEntry(id, ''),
    onSuccess: () => invalidateSchedule(queryClient),
    onError: (error) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  });
  const waiting = entry.data;
  if (!waiting || (followUpId !== undefined && waiting.followUpId === followUpId)) return null;
  const may = canWriteWaitlistEntry(
    { permissions: session?.permissions ?? [], profileId: session?.profile?.id ?? null },
    waiting,
  );
  return (
    <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
      <span title={formatCalendarDate(waiting.until, i18n.language)}>
        {t('waitlist.onTheWaitlist')}
      </span>
      {may ? (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            disabled={remove.isPending}
            className="cursor-pointer border-none bg-transparent p-0 text-primary hover:underline"
            onClick={() => {
              remove.mutate(waiting.id);
            }}
          >
            {t('waitlist.removeShort')}
          </button>
        </>
      ) : null}
    </p>
  );
}
