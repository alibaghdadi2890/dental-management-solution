import { TooltipProvider } from '@/components/ui/tooltip';
import { createFileRoute } from '@tanstack/react-router';
import { useSession } from '@/features/auth/session';
import { ReceiptView } from '@/features/inventory/receipt-page';

/** A receipt (B1): its own page, where it is priced, edited and voided. */
export const Route = createFileRoute('/_app/inventory/receipts/$receiptId')({
  staticData: { navKey: 'inventory' },
  component: ReceiptRoute,
});

function ReceiptRoute() {
  const { receiptId } = Route.useParams();
  const { data: session } = useSession();
  if (!session?.tenant || !session.permissions.includes('inventory:read')) return null;
  return (
    <TooltipProvider>
      <ReceiptView key={receiptId} session={session} receiptId={receiptId} />
    </TooltipProvider>
  );
}
