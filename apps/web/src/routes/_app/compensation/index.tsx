import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router';
import { useSession } from '@/features/auth/session';
import { monthOf, parseMonth } from '@/features/compensation/months';
import { ReportPage } from '@/features/compensation/report-page';
import { todayIn } from '@/lib/format';

export const Route = createFileRoute('/_app/compensation/')({
  staticData: { navKey: 'compensation' },
  validateSearch: (search: { month?: unknown } & SearchSchemaInput) => ({
    month: parseMonth(search.month, '') || undefined,
  }),
  component: CompensationRoute,
});

function CompensationRoute() {
  const { month } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  const current = monthOf(todayIn(session.tenant.timeZone));
  return (
    <ReportPage
      month={month ?? current}
      latest={current}
      onMonth={(next) => {
        void navigate({ search: { month: next === current ? undefined : next } });
      }}
    />
  );
}
