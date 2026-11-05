import {
  type Appointment,
  canCancel,
  canCheckIn,
  canConfirm,
  canMarkNoShow,
  canMove,
  canRestore,
  canWriteAppointment,
} from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { apiErrorMessage } from '@/lib/api-error-message';
import { todayIn } from '@/lib/format';
import {
  cancelAppointment,
  changeAppointmentRoom,
  checkInAppointment,
  confirmAppointment,
  invalidateSchedule,
  markNoShow,
  restoreAppointment,
  undoCheckIn,
} from './scheduling-api';

/** What this caller may do to this appointment now: the same rules as the API (A7, G21). */
export interface AppointmentAbilities {
  write: boolean;
  checkIn: boolean;
  confirm: boolean;
  move: boolean;
  /** The Edit appointment panel: what may move may be edited (ADR-0075). */
  edit: boolean;
  noShow: boolean;
  cancel: boolean;
  restore: boolean;
  undoCheckIn: boolean;
  startVisit: boolean;
}

const NONE: AppointmentAbilities = {
  write: false,
  checkIn: false,
  confirm: false,
  move: false,
  edit: false,
  noShow: false,
  cancel: false,
  restore: false,
  undoCheckIn: false,
  startVisit: false,
};

export function useAppointmentAbilities(): (appointment: Appointment) => AppointmentAbilities {
  const { data: session } = useSession();
  return (appointment) => {
    if (!session?.tenant) return NONE;
    const today = todayIn(session.tenant.timeZone);
    const moment = appointment;
    const write = canWriteAppointment(
      { permissions: session.permissions, profileId: session.profile?.id ?? null },
      appointment,
    );
    const canVisit = session.permissions.includes('visit:start');
    const waiting = appointment.status === 'booked' || appointment.status === 'confirmed';
    const move = write && canMove(moment, today);
    return {
      write,
      checkIn: write && canCheckIn(moment, today),
      confirm: write && canConfirm(moment, today),
      move,
      edit: move,
      noShow: write && canMarkNoShow(moment, new Date()),
      cancel: write && canCancel(moment),
      restore: write && canRestore(moment, new Date()),
      undoCheckIn: write && appointment.status === 'checked_in',
      // Whoever may start visits: since ADR-0074, the front desk too, once the patient is in the room.
      startVisit:
        canVisit &&
        (appointment.status === 'checked_in' || (waiting && appointment.localDate === today)),
    };
  };
}

/** One action: invalidates the schedule either way, toasts what happened. */
function useAction<TInput>(run: (input: TInput) => Promise<Appointment>, done: string) {
  const { i18n } = useTranslation('scheduling');
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      toast(done);
      return invalidateSchedule(queryClient);
    },
    onError: (error) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      return invalidateSchedule(queryClient);
    },
  });
}

/** The popover's and the board's one-click actions. */
export function useAppointmentActions() {
  const { t } = useTranslation('scheduling');
  return {
    confirm: useAction((id: string) => confirmAppointment(id), t('toast.confirmed')),
    checkIn: useAction(
      ({ id, roomId }: { id: string; roomId?: string }) => checkInAppointment(id, roomId),
      t('toast.checkedIn'),
    ),
    undoCheckIn: useAction((id: string) => undoCheckIn(id), t('toast.checkInUndone')),
    noShow: useAction((id: string) => markNoShow(id), t('toast.noShow')),
    cancel: useAction(
      ({ id, reason }: { id: string; reason: string }) => cancelAppointment(id, reason),
      t('toast.cancelled'),
    ),
    restore: useAction(
      ({ id, override }: { id: string; override: boolean }) => restoreAppointment(id, override),
      t('toast.restored'),
    ),
    room: useAction(
      ({ id, roomId }: { id: string; roomId: string | null }) => changeAppointmentRoom(id, roomId),
      t('toast.roomChanged'),
    ),
  };
}
