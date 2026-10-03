import { createFileRoute } from '@tanstack/react-router';
import { ReceiptDocument } from '@/features/billing/printables/receipt-document';

export const Route = createFileRoute('/print/receipt/$paymentId')({
  component: function ReceiptDocumentRoute() {
    const { paymentId } = Route.useParams();
    return <ReceiptDocument paymentId={paymentId} />;
  },
});
