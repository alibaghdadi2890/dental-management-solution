import { createFileRoute, type SearchSchemaInput, stripSearchParams } from '@tanstack/react-router';
import { PaymentsPage } from '@/features/billing/payments-screen/payments-page';
import {
  PAYMENTS_SEARCH_DEFAULTS,
  type PaymentsSearchInput,
  parsePaymentsSearch,
} from '@/features/billing/payments-screen/payments-search';

export const Route = createFileRoute('/_app/payments/')({
  staticData: { navKey: 'payments' },
  validateSearch: (search: PaymentsSearchInput & SearchSchemaInput) => parsePaymentsSearch(search),
  search: { middlewares: [stripSearchParams(PAYMENTS_SEARCH_DEFAULTS)] },
  component: PaymentsRoute,
});

function PaymentsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PaymentsPage
      search={search}
      onSearch={(next, options) => {
        void navigate({ search: next, replace: options?.replace ?? false });
      }}
    />
  );
}
