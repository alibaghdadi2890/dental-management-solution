import { isoDateSchema } from '@dcm/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useSession } from '@/features/auth/session';
import { SupplierPage } from '@/features/inventory/supplier-page';

const searchSchema = z.object({
  tab: z.enum(['statement', 'receipts']).optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
});

/** A supplier's page (Part D, like a lab's): the tab and the statement's period in the URL. */
export const Route = createFileRoute('/_app/inventory/suppliers/$supplierId')({
  staticData: { navKey: 'inventory' },
  validateSearch: searchSchema,
  component: SupplierRoute,
});

function SupplierRoute() {
  const { supplierId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant || !session.permissions.includes('inventory:read')) return null;
  return (
    <TooltipProvider>
      <SupplierPage
        key={supplierId}
        session={session}
        supplierId={supplierId}
        search={search}
        onSearch={(next) => {
          void navigate({ search: next, replace: true });
        }}
      />
    </TooltipProvider>
  );
}
