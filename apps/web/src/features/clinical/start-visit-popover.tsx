import type { BranchRef } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Popover } from 'radix-ui';
import { type ReactNode, type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useSession } from '@/features/auth/session';
import { useActingTenantId } from '@/features/platform/acting-tenant';
import { branchRoomsQuery, tenancyKeys } from '@/features/tenancy/tenancy-api';
import { branchPractitionersQuery, userKeys } from '@/features/users/users-api';
import { ApiError } from '@/lib/api';
import { startVisitMutation } from './visit-mutations';
import { startDefaultsQuery } from './visits-api';

type FieldName = 'dentist' | 'room';
type Errors = Partial<Record<FieldName | 'form', string>>;

/** The start errors that belong on a field (spec §HTTP `POST /visits`); `stale` = the list the
 * field was chosen from is out of date, so it is reloaded. */
const FIELD_ERRORS = {
  'visit.room_busy': { field: 'room', key: 'startVisit.errors.roomBusy', stale: false },
  'visit.room_required': { field: 'room', key: 'startVisit.errors.roomRequired', stale: true },
  'visit.room_invalid': { field: 'room', key: 'startVisit.errors.roomInvalid', stale: true },
  'visit.dentist_invalid': {
    field: 'dentist',
    key: 'startVisit.errors.dentistInvalid',
    stale: true,
  },
} as const satisfies Record<string, { field: FieldName; key: string; stale: boolean }>;

const isFieldError = (code: string): code is keyof typeof FIELD_ERRORS =>
  Object.hasOwn(FIELD_ERRORS, code);

/**
 * The Start visit popover (spec V3/W7), anchored to its trigger (`children`): the dentist — the
 * session branch's dentists, the caller pre-selected when they are one — and the room — the
 * branch's active rooms, required when it has any, hidden when it has none (W7) — then
 * `POST /visits` and on to the workspace. A patient who already has a live visit gets that one
 * back (`resumed`), which is where they were going anyway: no toast either way. Without a
 * branch in the session, it only says why a visit can't start.
 */
export function StartVisitPopover({
  patientId,
  children,
}: {
  patientId: string;
  /** The trigger button. */
  children: ReactNode;
}) {
  const { t } = useTranslation('clinical');
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const branch = useSession().data?.branch ?? null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-labelledby={titleId}
          className="z-30 w-[300px] max-w-[calc(100vw-24px)] animate-fadein rounded-[10px] border border-border bg-surface p-4 shadow-[0_10px_28px_rgba(27,26,31,.14)]"
        >
          <h2 id={titleId} className="m-0 mb-3.5 text-[14px] leading-none font-semibold">
            {t('startVisit.title')}
          </h2>
          {branch ? (
            <StartVisitForm
              patientId={patientId}
              branch={branch}
              onCancel={() => {
                setOpen(false);
              }}
              onStarted={() => {
                setOpen(false);
              }}
            />
          ) : (
            <p className="m-0 text-[12.5px] leading-[1.45] text-ink-secondary">
              {t('startVisit.noBranch')}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Mounted only while the popover is open, so every opening reads fresh defaults (the room it
 * suggests must still be free) and starts from them. */
function StartVisitForm({
  patientId,
  branch,
  onCancel,
  onStarted,
}: {
  patientId: string;
  branch: BranchRef;
  onCancel: () => void;
  onStarted: () => void;
}) {
  const { t } = useTranslation(['clinical', 'common']);
  const queryClient = useQueryClient();
  const tenantId = useActingTenantId();
  const navigate = useNavigate();
  const practitioners = useQuery(branchPractitionersQuery(branch.id));
  const rooms = useQuery(branchRoomsQuery(branch.id));
  const defaults = useQuery(startDefaultsQuery());
  const start = useMutation(startVisitMutation(queryClient, tenantId));

  // `null` = not picked yet: the default applies once it has loaded.
  const [picked, setPicked] = useState<Record<FieldName, string | null>>({
    dentist: null,
    room: null,
  });
  const [errors, setErrors] = useState<Errors>({});

  const activeRooms = rooms.data?.filter((room) => room.active) ?? [];
  // A default that is no longer listed (a dentist moved, a room deactivated) is no default.
  const listed = (value: string | null | undefined, items: readonly { id: string }[]) =>
    value && items.some((item) => item.id === value) ? value : '';
  const dentistId = picked.dentist ?? listed(defaults.data?.dentistId, practitioners.data ?? []);
  const roomId = picked.room ?? listed(defaults.data?.roomId, activeRooms);
  const needsRoom = activeRooms.length > 0;

  const loading = practitioners.isPending || rooms.isPending || defaults.isPending;
  const loadFailed = practitioners.isError || rooms.isError || defaults.isError;
  const noDentist = practitioners.data?.length === 0;

  const pick = (field: FieldName, value: string) => {
    setPicked((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (start.isPending) return;
    const missing: Errors = {
      ...(dentistId ? {} : { dentist: t('startVisit.errors.dentistRequired') }),
      ...(needsRoom && !roomId ? { room: t('startVisit.errors.roomRequired') } : {}),
    };
    setErrors(missing);
    if (missing.dentist || missing.room) return;
    start.mutate(
      { patientId, dentistId, ...(needsRoom ? { roomId } : {}) },
      {
        onSuccess: ({ visit }) => {
          onStarted();
          void navigate({ to: '/visits/$visitId', params: { visitId: visit.id } });
        },
        onError: (error) => {
          const code = error instanceof ApiError ? error.code : undefined;
          if (code !== undefined && isFieldError(code)) {
            const known = FIELD_ERRORS[code];
            setErrors({ [known.field]: t(known.key) });
            if (known.stale) {
              void queryClient.invalidateQueries({
                queryKey:
                  known.field === 'room'
                    ? tenancyKeys.rooms(tenantId, branch.id)
                    : userKeys.branchPractitioners(tenantId, branch.id),
              });
            }
            return;
          }
          setErrors({
            form:
              code === 'patient.archived'
                ? t('startVisit.errors.archived')
                : t('startVisit.errors.failed', { reason: error.message }),
          });
        },
      },
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] leading-none text-ink-muted">
        <Spinner tone="dark" />
        {t('startVisit.loading')}
      </div>
    );
  }
  if (loadFailed) {
    return (
      <p role="alert" className="m-0 text-[12.5px] leading-[1.45] text-danger">
        {t('startVisit.loadFailed')}
      </p>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label={t('startVisit.dentist')} error={errors.dentist}>
        {(field) => (
          <Select
            {...field}
            value={dentistId}
            disabled={noDentist}
            onChange={(event) => {
              pick('dentist', event.target.value);
            }}
          >
            <option value="" disabled>
              {t('startVisit.choose')}
            </option>
            {practitioners.data.map((practitioner) => (
              <option key={practitioner.id} value={practitioner.id}>
                {practitioner.displayName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {noDentist && (
        <p className="-mt-2 mb-0 text-xs leading-tight text-ink-muted">
          {t('startVisit.noDentist', { branch: branch.name })}
        </p>
      )}
      {needsRoom && (
        <Field label={t('startVisit.room')} error={errors.room}>
          {(field) => (
            <Select
              {...field}
              value={roomId}
              onChange={(event) => {
                pick('room', event.target.value);
              }}
            >
              <option value="" disabled>
                {t('startVisit.choose')}
              </option>
              {activeRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {errors.form && (
        <p role="alert" className="m-0 text-xs leading-tight font-medium text-danger">
          {errors.form}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-0.5">
        <Button size="sm" disabled={start.isPending} onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          busy={start.isPending}
          disabled={noDentist}
          className="font-semibold"
        >
          {t('startVisit.submit')}
        </Button>
      </div>
    </form>
  );
}
