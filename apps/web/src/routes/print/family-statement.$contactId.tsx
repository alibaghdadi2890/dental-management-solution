import { createFileRoute } from '@tanstack/react-router';
import { FamilyStatementDocument } from '@/features/billing/printables/family-statement-document';

export const Route = createFileRoute('/print/family-statement/$contactId')({
  component: function FamilyStatementDocumentRoute() {
    const { contactId } = Route.useParams();
    return <FamilyStatementDocument contactId={contactId} />;
  },
});
