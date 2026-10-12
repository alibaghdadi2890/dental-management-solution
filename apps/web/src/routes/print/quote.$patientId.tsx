import { planPrioritySchema } from '@dcm/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { QuoteDocument } from '@/features/billing/printables/quote-document';

/** `?priority=` prints one phase of the plan; anything else, the whole plan. */
const quoteSearchSchema = z.object({
  priority: planPrioritySchema.optional().catch(undefined),
});

export const Route = createFileRoute('/print/quote/$patientId')({
  validateSearch: (raw) => quoteSearchSchema.parse(raw),
  component: function QuoteDocumentRoute() {
    const { patientId } = Route.useParams();
    const { priority } = Route.useSearch();
    return <QuoteDocument patientId={patientId} priority={priority} />;
  },
});
