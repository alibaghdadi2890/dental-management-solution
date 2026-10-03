import { createFileRoute } from '@tanstack/react-router';
import { QuoteDocument } from '@/features/billing/printables/quote-document';

export const Route = createFileRoute('/print/quote/$patientId')({
  component: function QuoteDocumentRoute() {
    const { patientId } = Route.useParams();
    return <QuoteDocument patientId={patientId} />;
  },
});
