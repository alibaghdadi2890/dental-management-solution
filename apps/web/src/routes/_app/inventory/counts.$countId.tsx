import { TooltipProvider } from '@/components/ui/tooltip';
import { createFileRoute } from '@tanstack/react-router';
import { useSession } from '@/features/auth/session';
import { CountPage } from '@/features/inventory/count-page';

/** A count sheet (B5): its own page. */
export const Route = createFileRoute('/_app/inventory/counts/$countId')({
  staticData: { navKey: 'inventory' },
  component: CountRoute,
});

function CountRoute() {
  const { countId } = Route.useParams();
  const { data: session } = useSession();
  if (!session?.tenant || !session.permissions.includes('inventory:read')) return null;
  return (
    <TooltipProvider>
      <CountPage key={countId} session={session} countId={countId} />
    </TooltipProvider>
  );
}
