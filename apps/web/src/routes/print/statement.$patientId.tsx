import { createFileRoute } from '@tanstack/react-router';
import { StatementDocument } from '@/features/billing/printables/statement-document';

export const Route = createFileRoute('/print/statement/$patientId')({
  component: function StatementDocumentRoute() {
    const { patientId } = Route.useParams();
    return <StatementDocument patientId={patientId} />;
  },
});
