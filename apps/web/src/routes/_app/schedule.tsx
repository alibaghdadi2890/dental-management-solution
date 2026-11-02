import { createFileRoute } from '@tanstack/react-router';
import { idSchema, isoDateSchema } from '@dcm/contracts';
import { z } from 'zod';
import { type ScheduleSearch, SchedulePage } from '@/features/scheduling/schedule-page';

const scheduleSearchSchema = z.object({
  date: isoDateSchema.optional().catch(undefined),
  view: z.enum(['day', 'week']).optional().catch(undefined),
  dentist: idSchema.optional().catch(undefined),
  room: idSchema.optional().catch(undefined),
  unresolved: z.boolean().optional().catch(undefined),
  appointment: idSchema.optional().catch(undefined),
  book: z.boolean().optional().catch(undefined),
  bookFor: idSchema.optional().catch(undefined),
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
