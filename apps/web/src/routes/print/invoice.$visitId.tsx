import { createFileRoute } from '@tanstack/react-router';
import { InvoiceDocument } from '@/features/billing/printables/invoice-document';

export const Route = createFileRoute('/print/invoice/$visitId')({
  component: function InvoiceDocumentRoute() {
    const { visitId } = Route.useParams();
    return <InvoiceDocument visitId={visitId} />;
  },
});
