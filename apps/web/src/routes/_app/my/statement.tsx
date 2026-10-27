import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router';
import { parseMonth } from '@/features/compensation/months';
import { MyStatementPage } from '@/features/compensation/my-statement-page';

export const Route = createFileRoute('/_app/my/statement')({
  staticData: { navKey: 'myStatement' },
  validateSearch: (search: { month?: unknown } & SearchSchemaInput) => ({
    month: parseMonth(search.month, '') || undefined,
  }),
  component: MyStatementRoute,
});

function MyStatementRoute() {
  const { month } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MyStatementPage
      month={month}
      onMonth={(next) => {
        void navigate({ search: { month: next } });
      }}
    />
  );
}
