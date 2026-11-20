import { createFileRoute } from '@tanstack/react-router';
import {
  APPOINTMENT_LIST_STATUSES,
  idSchema,
  isoDateSchema,
  WAITLIST_APPOINTMENT_FILTERS,
  WAITLIST_VIEW_STATUSES,
} from '@dcm/contracts';
import { z } from 'zod';
import { type ScheduleSearch, SchedulePage } from '@/features/scheduling/schedule-page';

const scheduleSearchSchema = z.object({
  date: isoDateSchema.optional().catch(undefined),
  view: z.enum(['day', 'week', 'waitlist']).optional().catch(undefined),
  dentist: idSchema.optional().catch(undefined),
  room: idSchema.optional().catch(undefined),
  unresolved: z.boolean().optional().catch(undefined),
  appointment: idSchema.optional().catch(undefined),
  book: z.boolean().optional().catch(undefined),
  bookFor: idSchema.optional().catch(undefined),
  list: z.boolean().optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  status: z.enum(APPOINTMENT_LIST_STATUSES).optional().catch(undefined),
  weekday: z.coerce.number().int().min(0).max(6).optional().catch(undefined),
  hour: z.coerce.number().int().min(0).max(23).optional().catch(undefined),
  due: z.boolean().optional().catch(undefined),
  branch: idSchema.optional().catch(undefined),
  wstatus: z.enum(WAITLIST_VIEW_STATUSES).optional().catch(undefined),
  wdentist: idSchema.optional().catch(undefined),
  wappt: z.enum(WAITLIST_APPOINTMENT_FILTERS).optional().catch(undefined),
  wfits: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/schedule')({
  staticData: { navKey: 'schedule' },
  validateSearch: (search: Record<string, unknown>): ScheduleSearch =>
    scheduleSearchSchema.parse(search),
  component: ScheduleRoute,
});

function ScheduleRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SchedulePage
      search={search}
      onSearch={(next) => {
        void navigate({ search: next });
      }}
    />
  );
}
